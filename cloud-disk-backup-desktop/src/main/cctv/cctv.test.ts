import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, type UploadSession } from '../api';
import { CctvEngine, type CctvTransport, type ClipStart } from './engine';
import { clipStart, explainFfmpegError, recordArgs } from './ffmpeg';
import { redact, streamUrl } from './streams';

const session = (id: number): UploadSession => ({ id, nodeId: id, mode: 'SINGLE', partSize: 0, partCount: 1, uploadUrl: 'http://s/x', contentType: 'video/mp4', expiresAt: '' });

class FakeFfmpeg extends EventEmitter {
  stderr = new EventEmitter();
  killed: string[] = [];
  kill(signal?: string) { this.killed.push(signal ?? 'SIGTERM'); setTimeout(() => this.emit('exit', null, signal), 5); return true; }
  crash(message: string) { this.stderr.emit('data', Buffer.from(message)); this.emit('exit', 1, null); }
}

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); }
};

describe('stream addresses', () => {
  const base = { host: '192.168.1.64', port: 554, username: 'admin', stream: 'main' as const, urlTemplate: null };
  it('builds brand addresses with escaped credentials', () => {
    expect(streamUrl({ ...base, brand: 'hikvision' }, 3, 'p@ss:1')).toBe('rtsp://admin:p%40ss%3A1@192.168.1.64:554/Streaming/Channels/301');
    expect(streamUrl({ ...base, brand: 'dahua', stream: 'sub' }, 2, 'x')).toBe('rtsp://admin:x@192.168.1.64:554/cam/realmonitor?channel=2&subtype=1');
    expect(streamUrl({ ...base, brand: 'uniview' }, 1, 'x')).toBe('rtsp://admin:x@192.168.1.64:554/unicast/c1/s0/live');
    expect(streamUrl({ ...base, brand: 'custom', urlTemplate: 'rtsp://10.0.0.5:8554/live/ch{channel}' }, 4, 'x')).toBe('rtsp://admin:x@10.0.0.5:8554/live/ch4');
    expect(() => streamUrl({ ...base, brand: 'hikvision', host: 'bad host/x' }, 1, '')).toThrow();
  });
  it('never shows the password in messages', () => {
    expect(redact('Error opening rtsp://admin:secret@10.0.0.1:554/x: 401')).toBe('Error opening rtsp://***@10.0.0.1:554/x: 401');
    expect(explainFfmpegError('method DESCRIBE failed: 401 Unauthorized')).toMatch(/password/);
  });
  it('records rtsp over tcp into clock-aligned fragmented clips', () => {
    const args = recordArgs('rtsp://a/b', '/spool/7', 10);
    expect(args).toEqual(expect.arrayContaining(['-rtsp_transport', 'tcp', '-c:v', 'copy', '-segment_time', '10', '-segment_atclocktime', '1']));
    expect(args.join(' ')).toContain('frag_keyframe');
    expect(clipStart('2026-11-18_14-05-30.mp4')?.getTime()).toBe(new Date(2026, 10, 18, 14, 5, 30).getTime());
    expect(clipStart('notes.txt')).toBeNull();
  });
});

describe('CctvEngine', () => {
  let dir = '';
  let engine: CctvEngine | null = null;
  afterEach(async () => { await engine?.stop(); engine = null; rmSync(dir, { recursive: true, force: true }); });

  function setup(transport: Partial<CctvTransport> = {}) {
    dir = mkdtempSync(join(tmpdir(), 'cctv-'));
    const procs: FakeFfmpeg[] = [];
    const clips: ClipStart[] = [];
    const uploaded: string[] = [];
    const states: string[] = [];
    engine = new CctvEngine({
      spoolDir: dir, ffmpegPath: '/fake/ffmpeg', pollMs: 30, concurrency: 1, offlineRetryMs: 60, clipSeconds: 10, stallMs: 60_000,
      spawn: () => { const p = new FakeFfmpeg(); procs.push(p); return p as unknown as ChildProcess; },
      transport: {
        startClip: async (_id, clip) => { clips.push(clip); return { nodeId: clips.length, path: `CCTV/x/${clip.startedAt}`, upload: session(clips.length) }; },
        upload: async (_s, path) => { uploaded.push(path.split(/[\\/]/).pop()!); },
        reportStatus: async (_id, state) => { states.push(state); },
        ...transport,
      },
    });
    const write = (name: string, bytes = 1000) => { mkdirSync(join(dir, '7'), { recursive: true }); writeFileSync(join(dir, '7', name), Buffer.alloc(bytes)); };
    return { procs, clips, uploaded, states, write, camDir: join(dir, '7') };
  }

  it('uploads each clip once it is finished, oldest first, and keeps the one being written', async () => {
    const t = setup();
    engine!.setCameras([{ id: 7, name: 'Gate', url: 'rtsp://admin:pw@nvr/1' }]);
    await until(() => t.procs.length === 1);
    t.write('2026-11-18_14-05-10.mp4', 1250);
    t.write('2026-11-18_14-05-20.mp4', 900);
    t.write('2026-11-18_14-05-30.mp4', 10); // being written
    await until(() => engine!.snapshot().cameras[0]!.uploadedClips === 2);
    expect(t.uploaded).toEqual(['2026-11-18_14-05-10.mp4', '2026-11-18_14-05-20.mp4']);
    expect(t.clips[0]).toMatchObject({ sizeBytes: 1250, durationMs: 10_000, contentType: 'video/mp4' });
    expect(t.clips[0]!.idempotencyKey).toMatch(/^tv-[0-9a-f]{40}$/);
    expect(readdirSync(t.camDir)).toEqual(['2026-11-18_14-05-30.mp4']);
    const live = engine!.snapshot().cameras[0]!;
    expect(live.state).toBe('recording');
    expect(live.cloudUpTo).toBe(new Date(2026, 10, 18, 14, 5, 30).toISOString());
    expect(live.bitrate).toBe(720); // 900 bytes in 10 s

    // The stream drops: the last clip is complete now and uploads; recording restarts.
    t.procs[0]!.crash('rtsp://admin:pw@nvr/1: Connection timed out');
    await until(() => t.uploaded.length === 3, 4000);
    expect(engine!.snapshot().cameras[0]).toMatchObject({ state: 'reconnecting', message: 'The recorder is not reachable on the network.' });
    await until(() => t.procs.length === 2, 4000);
    expect(t.states).toContain('OFFLINE');
  });

  it('keeps clips while offline and sends them when the connection is back; a clip already stored is not sent again', async () => {
    let online = false;
    const t = setup({
      startClip: async (_id, clip) => {
        if (!online) throw new ApiError(0, "Can't reach HarDisk");
        return { nodeId: 1, path: null, upload: clip.sizeBytes === 500 ? null : session(1) };
      },
    });
    t.write('2026-11-18_10-00-00.mp4', 500);
    t.write('2026-11-18_10-00-10.mp4', 800);
    engine!.setCameras([{ id: 7, name: 'Gate', url: 'rtsp://nvr/1' }]);
    await until(() => t.procs.length === 1);
    t.write('2026-11-18_10-00-20.mp4', 5); // the clip ffmpeg is writing now
    await new Promise((r) => setTimeout(r, 200));
    expect(readdirSync(t.camDir)).toHaveLength(3);
    expect(engine!.snapshot().spoolBytes).toBe(1305);
    online = true;
    await until(() => readdirSync(t.camDir).length === 1, 4000);
    expect(t.uploaded).toEqual(['2026-11-18_10-00-10.mp4']); // the 500-byte one was already stored
    expect(existsSync(join(t.camDir, '2026-11-18_10-00-20.mp4'))).toBe(true);
    expect(engine!.snapshot().cameras[0]!.uploadedClips).toBe(2);
  });

  it('says so when ffmpeg is missing, and starts once it is chosen', async () => {
    const t = setup();
    engine!.setFfmpeg(null);
    engine!.setCameras([{ id: 7, name: 'Gate', url: 'rtsp://nvr/1' }]);
    expect(engine!.snapshot().cameras[0]).toMatchObject({ state: 'error', message: expect.stringMatching(/ffmpeg/) });
    expect(t.procs).toHaveLength(0);
    engine!.setFfmpeg('/usr/bin/ffmpeg');
    await until(() => t.procs.length === 1);
  });
});
