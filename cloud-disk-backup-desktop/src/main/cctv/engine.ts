import { EventEmitter } from 'node:events';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ApiError, type UploadSession } from '../api';
import type { CameraLive, CameraState, CctvActivity, CctvSnapshot } from '../../shared/types';
import { CLIP_SECONDS, clipStart, explainFfmpegError, isClipName, recordArgs } from './ffmpeg';
import { redact } from './streams';

export interface ClipStart {
  startedAt: string;
  durationMs: number;
  sizeBytes: number;
  contentType: string;
  idempotencyKey: string;
}

/** What the engine needs from the server; the app passes the API client, tests a fake. */
export interface CctvTransport {
  startClip(cameraId: number, clip: ClipStart): Promise<{ nodeId: number; path: string | null; upload: UploadSession | null }>;
  upload(session: UploadSession, absolutePath: string, sizeBytes: number): Promise<void>;
  reportStatus(cameraId: number, state: 'RECORDING' | 'OFFLINE' | 'ERROR' | 'STOPPED', message: string | null): Promise<unknown>;
}

/** A camera to record: its server id and the stream address (with credentials; never shown). */
export interface CameraJob { id: number; name: string; url: string }

export interface CctvEngineOptions {
  transport: CctvTransport;
  /** Clips wait here until they are uploaded (one folder per camera). */
  spoolDir: string;
  ffmpegPath: string | null;
  spawn?: (command: string, args: string[]) => ChildProcess;
  clipSeconds?: number;
  pollMs?: number;
  concurrency?: number;
  /** Clips kept locally while offline; beyond this the oldest are dropped (the recorder still has them). */
  maxSpoolBytes?: number;
  offlineRetryMs?: number;
  /** A running recording whose newest clip stops growing this long is restarted. */
  stallMs?: number;
  statusEveryMs?: number;
}

interface Camera {
  job: CameraJob;
  dir: string;
  proc: ChildProcess | null;
  stopping: boolean;
  startedAt: number;
  restartTimer: NodeJS.Timeout | null;
  failures: number;
  stderr: string;
  newest: { name: string; size: number; at: number } | null;
  /** Clips that existed when the running ffmpeg started: finished, whatever ffmpeg does now. */
  before: Set<string>;
  live: CameraLive;
  reportedState: CameraState | null;
}

interface Job { cameraId: number; name: string; attempts: number; notBefore: number }

// Every second missed is footage lost: retry quickly, at most every 10 s, for as long as the recorder is away.
const RESTART_DELAYS = [1_000, 2_000, 5_000, 10_000];
const MAX_ACTIVITY = 100;
const SERVER_STATE: Record<CameraState, 'RECORDING' | 'OFFLINE' | 'ERROR' | 'STOPPED'> = {
  starting: 'RECORDING', recording: 'RECORDING', reconnecting: 'OFFLINE', error: 'ERROR', stopped: 'STOPPED',
};

/**
 * Records CCTV cameras to the cloud: one ffmpeg per camera cuts the live stream into short clips on this computer, and
 * every finished clip is uploaded right away and then deleted locally. While offline, clips wait (up to a size limit)
 * and are uploaded oldest first when the connection returns. A stream that drops or stalls is restarted with backoff.
 *
 * Emits `snapshot` (throttled) and `auth-lost`.
 */
export class CctvEngine extends EventEmitter {
  private readonly cameras = new Map<number, Camera>();
  private readonly queue: Job[] = [];
  private readonly inFlight = new Set<string>();
  private readonly activity: CctvActivity[] = [];
  private ffmpegPath: string | null;
  private spoolBytes = 0;
  private poller: NodeJS.Timeout | null = null;
  private statusTimer: NodeJS.Timeout | null = null;
  private wake: NodeJS.Timeout | null = null;
  private emitTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private stopped = false;
  private readonly o: Required<Omit<CctvEngineOptions, 'ffmpegPath' | 'spawn'>> & { spawn: (command: string, args: string[]) => ChildProcess };

  constructor(options: CctvEngineOptions) {
    super();
    this.ffmpegPath = options.ffmpegPath;
    this.o = {
      transport: options.transport, spoolDir: options.spoolDir,
      spawn: options.spawn ?? ((command, args) => nodeSpawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })),
      clipSeconds: options.clipSeconds ?? CLIP_SECONDS, pollMs: options.pollMs ?? 2_000, concurrency: options.concurrency ?? 3,
      maxSpoolBytes: options.maxSpoolBytes ?? 20e9, offlineRetryMs: options.offlineRetryMs ?? 15_000, stallMs: options.stallMs ?? 45_000,
      statusEveryMs: options.statusEveryMs ?? 60_000,
    };
  }

  get ffmpeg(): string | null { return this.ffmpegPath; }

  setFfmpeg(path: string | null): void {
    this.ffmpegPath = path;
    for (const c of this.cameras.values()) if (!c.proc) this.launch(c);
    this.changed();
  }

  /** Starts cameras that are new, restarts those whose address changed, stops the rest. Their waiting clips still upload. */
  setCameras(jobs: CameraJob[]): void {
    this.stopped = false;
    const wanted = new Map(jobs.map((j) => [j.id, j]));
    for (const [id, c] of this.cameras) {
      const next = wanted.get(id);
      if (!next) { this.halt(c); this.cameras.delete(id); continue; }
      const urlChanged = next.url !== c.job.url;
      c.job = next;
      c.live = { ...c.live };
      if (urlChanged) {
        c.failures = 0;
        this.halt(c);
        void this.exited(c).then(() => { if (this.cameras.get(id) === c) { c.stopping = false; this.launch(c); } });
      }
    }
    for (const job of jobs) {
      if (this.cameras.has(job.id)) continue;
      const c: Camera = {
        job, dir: join(this.o.spoolDir, String(job.id)), proc: null, stopping: false, startedAt: 0, restartTimer: null, failures: 0, stderr: '', newest: null, before: new Set(),
        live: { id: job.id, state: 'starting', message: null, cloudUpTo: null, queuedClips: 0, uploadedClips: 0, uploadedBytes: 0, bitrate: 0 }, reportedState: null,
      };
      this.cameras.set(job.id, c);
      this.launch(c);
    }
    if (!this.poller) this.poller = setInterval(() => void this.poll(), this.o.pollMs);
    if (!this.statusTimer) this.statusTimer = setInterval(() => this.reportAll(true), this.o.statusEveryMs);
    void this.poll();
    this.changed();
  }

  /** Stops every recording (clips not yet uploaded stay on disk and go up on the next start). */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const c of this.cameras.values()) this.halt(c);
    for (const t of [this.poller, this.statusTimer, this.wake, this.emitTimer]) if (t) clearInterval(t);
    this.poller = this.statusTimer = this.wake = this.emitTimer = null;
    await Promise.all([...this.cameras.values()].map((c) => this.exited(c)));
    this.reportAll(false);
  }

  /** Forgets a camera removed for good: stops it and deletes its waiting clips. */
  async forget(cameraId: number): Promise<void> {
    const c = this.cameras.get(cameraId);
    const dir = c?.dir ?? join(this.o.spoolDir, String(cameraId));
    if (c) { this.halt(c); this.cameras.delete(cameraId); await this.exited(c); }
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i]!.cameraId === cameraId) this.queue.splice(i, 1);
    await rm(dir, { recursive: true, force: true });
    this.changed();
  }

  snapshot(): CctvSnapshot {
    return { ffmpegPath: this.ffmpegPath, cameras: [...this.cameras.values()].map((c) => ({ ...c.live })), spoolBytes: this.spoolBytes, activity: [...this.activity] };
  }

  // ---- recording ----

  private launch(c: Camera): void {
    if (this.stopped || c.proc || c.restartTimer) return;
    if (!this.ffmpegPath) { this.setState(c, 'error', 'ffmpeg is needed to record cameras. Install it, or choose where it is.'); return; }
    void mkdir(c.dir, { recursive: true }).then(() => readdir(c.dir)).then((existing) => {
      if (this.stopped || c.proc || !this.cameras.has(c.job.id)) return;
      c.before = new Set(existing.filter(isClipName));
      let proc: ChildProcess;
      try {
        proc = this.o.spawn(this.ffmpegPath!, recordArgs(c.job.url, c.dir, this.o.clipSeconds));
      } catch (error) {
        this.setState(c, 'error', `ffmpeg could not start: ${(error as Error).message}`);
        return;
      }
      c.proc = proc;
      c.stopping = false;
      c.startedAt = Date.now();
      c.stderr = '';
      c.newest = null;
      if (c.live.state !== 'recording') this.setState(c, c.failures === 0 ? 'starting' : 'reconnecting', c.live.message);
      proc.stderr?.on('data', (chunk: Buffer) => { c.stderr = (c.stderr + chunk.toString()).slice(-4000); });
      proc.on('error', (error) => { c.stderr += `\n${error.message}`; });
      proc.on('exit', () => this.onExit(c, proc));
    });
  }

  private onExit(c: Camera, proc: ChildProcess): void {
    if (c.proc !== proc) return;
    c.proc = null;
    void this.poll(); // the last clip is complete now
    if (c.stopping || this.stopped || !this.cameras.has(c.job.id)) { this.setState(c, 'stopped', null); return; }
    const message = redact(explainFfmpegError(redact(c.stderr)));
    c.failures++;
    const delay = RESTART_DELAYS[Math.min(c.failures - 1, RESTART_DELAYS.length - 1)]!;
    this.setState(c, /password|user name/.test(message) ? 'error' : 'reconnecting', message);
    if (c.failures === 1 || c.failures % 10 === 0) this.log(c, 'info', `Recording stopped: ${message} Trying again.`, 0);
    c.restartTimer = setTimeout(() => { c.restartTimer = null; this.launch(c); }, delay);
  }

  private halt(c: Camera): void {
    c.stopping = true;
    if (c.restartTimer) { clearTimeout(c.restartTimer); c.restartTimer = null; }
    // SIGINT lets ffmpeg close the current clip properly; clips are fragmented, so even a hard stop leaves a playable file.
    c.proc?.kill('SIGINT');
  }

  private exited(c: Camera): Promise<void> {
    const proc = c.proc;
    if (!proc) return Promise.resolve();
    return new Promise((done) => {
      const force = setTimeout(() => { proc.kill('SIGKILL'); done(); }, 3_000);
      proc.once('exit', () => { clearTimeout(force); done(); });
    });
  }

  // ---- finding finished clips ----

  /** Queues clips that are finished: every clip but the one being written, or all of them when ffmpeg is not running. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      let total = 0;
      for (const c of this.cameras.values()) total += await this.scanCamera(c);
      total += await this.scanOrphans();
      this.spoolBytes = total;
      if (total > this.o.maxSpoolBytes) await this.trimSpool();
      this.pump();
    } finally {
      this.polling = false;
    }
  }

  private async scanCamera(c: Camera): Promise<number> {
    const clips = await this.clipsIn(c.dir);
    let bytes = 0;
    const now = Date.now();
    for (const [i, clip] of clips.entries()) {
      bytes += clip.size;
      // Only a clip the running ffmpeg created can still be open: the last clip before a dropout uploads while it reconnects.
      const writing = i === clips.length - 1 && c.proc != null && !c.before.has(clip.name);
      if (writing) {
        // Watchdog: the newest clip must keep growing while ffmpeg runs.
        if (!c.newest || c.newest.name !== clip.name || c.newest.size !== clip.size) c.newest = { name: clip.name, size: clip.size, at: now };
        else if (now - c.newest.at > this.o.stallMs) { c.stderr += '\nThe recorder stopped sending video.'; c.proc?.kill('SIGKILL'); }
        if (c.live.state !== 'recording' && clip.size > 0) { c.failures = 0; this.setState(c, 'recording', null); }
        continue;
      }
      if (c.proc == null && now - clip.mtimeMs < 2_000) continue; // let a just-stopped ffmpeg finish writing
      this.enqueue(c.job.id, clip.name);
    }
    if (c.proc && clips.length === 0 && now - c.startedAt > this.o.stallMs) { c.stderr += '\nThe recorder sent no video.'; c.proc.kill('SIGKILL'); }
    const queued = this.queue.filter((j) => j.cameraId === c.job.id).length + [...this.inFlight].filter((k) => k.startsWith(`${c.job.id}/`)).length;
    if (queued !== c.live.queuedClips) { c.live = { ...c.live, queuedClips: queued }; this.changed(); }
    return bytes;
  }

  /** Clips of cameras no longer recorded here (removed, or left from before a restart) still upload while the camera exists. */
  private async scanOrphans(): Promise<number> {
    let bytes = 0;
    let dirs: string[];
    try { dirs = await readdir(this.o.spoolDir); } catch { return 0; }
    for (const d of dirs) {
      const id = Number(d);
      if (!Number.isInteger(id) || this.cameras.has(id)) continue;
      for (const clip of await this.clipsIn(join(this.o.spoolDir, d))) { bytes += clip.size; this.enqueue(id, clip.name); }
    }
    return bytes;
  }

  private async clipsIn(dir: string): Promise<{ name: string; size: number; mtimeMs: number }[]> {
    let names: string[];
    try { names = (await readdir(dir)).filter(isClipName).sort(); } catch { return []; }
    const out: { name: string; size: number; mtimeMs: number }[] = [];
    for (const name of names) {
      try { const s = await stat(join(dir, name)); out.push({ name, size: s.size, mtimeMs: s.mtimeMs }); } catch { /* uploaded meanwhile */ }
    }
    return out;
  }

  private enqueue(cameraId: number, name: string): void {
    const k = `${cameraId}/${name}`;
    if (this.inFlight.has(k) || this.queue.some((j) => j.cameraId === cameraId && j.name === name)) return;
    this.queue.push({ cameraId, name, attempts: 0, notBefore: 0 });
    this.queue.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async trimSpool(): Promise<void> {
    let over = this.spoolBytes - this.o.maxSpoolBytes;
    for (const job of [...this.queue]) {
      if (over <= 0) break;
      const path = join(this.o.spoolDir, String(job.cameraId), job.name);
      try {
        const { size } = await stat(path);
        await unlink(path);
        over -= size;
        this.spoolBytes -= size;
        this.queue.splice(this.queue.indexOf(job), 1);
        const c = this.cameras.get(job.cameraId);
        if (c) this.log(c, 'failed', `Dropped ${job.name}: not enough room to keep clips while uploads wait. The recorder still has it.`, size);
      } catch { /* gone */ }
    }
  }

  // ---- uploading ----

  private pump(): void {
    if (this.stopped && this.cameras.size === 0) return;
    const now = Date.now();
    while (this.inFlight.size < this.o.concurrency) {
      const i = this.queue.findIndex((j) => j.notBefore <= now);
      if (i < 0) break;
      const job = this.queue.splice(i, 1)[0]!;
      const k = `${job.cameraId}/${job.name}`;
      this.inFlight.add(k);
      void this.send(job).finally(() => { this.inFlight.delete(k); this.pump(); });
    }
    const next = this.queue.reduce((m, j) => Math.min(m, j.notBefore), Infinity);
    if (next !== Infinity && next > now && !this.wake) this.wake = setTimeout(() => { this.wake = null; this.pump(); }, next - now);
  }

  private async send(job: Job): Promise<void> {
    const dir = join(this.o.spoolDir, String(job.cameraId));
    const path = join(dir, job.name);
    const c = this.cameras.get(job.cameraId);
    let size: number;
    try { size = (await stat(path)).size; } catch { return; }
    if (size === 0) { await unlink(path).catch(() => undefined); return; }
    const start = clipStart(job.name) ?? new Date();
    const durationMs = await this.durationOf(dir, job.name, start);
    const key = 'tv-' + createHash('sha1').update(`${job.cameraId}/${job.name}/${size}`).digest('hex');
    try {
      const started = await this.o.transport.startClip(job.cameraId, {
        startedAt: start.toISOString(), durationMs, sizeBytes: size, contentType: 'video/mp4', idempotencyKey: key,
      });
      if (started.upload) await this.o.transport.upload(started.upload, path, size);
      await unlink(path).catch(() => undefined);
      if (c) {
        const end = new Date(start.getTime() + durationMs).toISOString();
        c.live = {
          ...c.live, uploadedClips: c.live.uploadedClips + 1, uploadedBytes: c.live.uploadedBytes + size,
          cloudUpTo: !c.live.cloudUpTo || end > c.live.cloudUpTo ? end : c.live.cloudUpTo,
          bitrate: durationMs > 0 ? Math.round((size * 8 * 1000) / durationMs) : c.live.bitrate,
        };
        this.log(c, 'uploaded', started.path ?? job.name, size);
      }
    } catch (error) {
      job.attempts++;
      if (error instanceof ApiError && error.offline) {
        job.notBefore = Date.now() + this.o.offlineRetryMs;
      } else if (error instanceof ApiError && error.status === 401) {
        job.notBefore = Date.now() + this.o.offlineRetryMs;
        this.emit('auth-lost');
      } else if (error instanceof ApiError && error.status === 404) {
        // The camera was removed (here or from another computer): its clips have nowhere to go.
        await unlink(path).catch(() => undefined);
        return;
      } else {
        job.notBefore = Date.now() + Math.min(60_000, 2_000 * 2 ** Math.min(job.attempts, 5));
        if (c && (job.attempts === 1 || job.attempts % 10 === 0)) {
          const message = error instanceof ApiError ? [error.message, error.description].filter(Boolean).join(' — ') : (error as Error).message;
          this.log(c, 'failed', `${job.name}: ${message}. Retrying.`, size);
          if (error instanceof ApiError && (error.status === 402 || error.status === 403)) this.setState(c, c.live.state, message);
        }
      }
      this.queue.push(job);
      this.queue.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  /**
   * Until the next clip of the camera started; for the last clip (stream ended, possibly cut short) until it was last
   * written; else the clip length.
   */
  private async durationOf(dir: string, name: string, start: Date): Promise<number> {
    const plausible = (ms: number) => ms > 0 && ms < this.o.clipSeconds * 3_000;
    try {
      const next = (await readdir(dir)).filter((n) => isClipName(n) && n > name).sort()[0];
      const nextStart = next ? clipStart(next) : null;
      if (nextStart && plausible(nextStart.getTime() - start.getTime())) return nextStart.getTime() - start.getTime();
      if (!next) {
        const written = (await stat(join(dir, name))).mtimeMs - start.getTime();
        if (plausible(written)) return Math.round(written);
      }
    } catch { /* default */ }
    return this.o.clipSeconds * 1000;
  }

  // ---- state ----

  private setState(c: Camera, state: CameraState, message: string | null): void {
    if (c.live.state === state && c.live.message === message) return;
    c.live = { ...c.live, state, message };
    this.report(c);
    this.changed();
  }

  private report(c: Camera): void {
    if (c.reportedState === c.live.state) return;
    c.reportedState = c.live.state;
    void this.o.transport.reportStatus(c.job.id, SERVER_STATE[c.live.state], c.live.message).catch(() => { c.reportedState = null; });
  }

  private reportAll(force: boolean): void {
    for (const c of this.cameras.values()) {
      if (force) c.reportedState = null;
      if (this.stopped) c.live = { ...c.live, state: 'stopped' };
      this.report(c);
    }
  }

  private log(c: Camera, kind: CctvActivity['kind'], message: string, sizeBytes: number): void {
    this.activity.unshift({ id: randomUUID(), at: new Date().toISOString(), cameraId: c.job.id, cameraName: c.job.name, kind, message, sizeBytes });
    this.activity.length = Math.min(this.activity.length, MAX_ACTIVITY);
    this.changed();
  }

  private changed(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => { this.emitTimer = null; this.emit('snapshot', this.snapshot()); }, 250);
  }
}
