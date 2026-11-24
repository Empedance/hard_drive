import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, type BackupFileRequest, type BackupFileResponse } from '../api';
import type { SourceInfo } from '../../shared/types';
import { BackupEngine, type BackupTransport } from './engine';

/** In-memory stand-in for the server: remembers stored files by path and size, like BackupService does. */
class FakeServer implements BackupTransport {
  stored = new Map<string, number>();
  starts: BackupFileRequest[] = [];
  uploads: string[] = [];
  statuses: [number, number, number][] = [];
  failNext: Error | null = null;
  private nextId = 1;

  async startFile(sourceId: number, request: BackupFileRequest): Promise<BackupFileResponse> {
    this.starts.push(request);
    if (this.failNext) { const e = this.failNext; this.failNext = null; throw e; }
    const key = `${sourceId}:${request.relativePath}`;
    const known = this.stored.get(key);
    const id = this.nextId++;
    if (known === request.sizeBytes) return { action: 'UNCHANGED', nodeId: id, upload: null };
    return { action: known == null ? 'CREATE' : 'REPLACE', nodeId: id,
      upload: { id, nodeId: id, mode: 'SINGLE', partSize: request.sizeBytes, partCount: 1, uploadUrl: `mem://${key}`, contentType: 'x', expiresAt: '' } };
  }
  async upload(session: { uploadUrl: string | null }, _path: string, size: number, onProgress: (n: number) => void): Promise<void> {
    const key = session.uploadUrl!.slice('mem://'.length);
    this.uploads.push(key);
    this.stored.set(key, size);
    onProgress(size);
  }
  async recordStatus(sourceId: number, files: number, bytes: number): Promise<unknown> { this.statuses.push([sourceId, files, bytes]); return {}; }
}

const source = (id: number, localPath: string): SourceInfo =>
  ({ id, deviceId: 1, name: 'Docs', localPath, remotePath: localPath.slice(1), folderId: 10, createdAt: '', lastBackupAt: null, filesCount: 0, bytesTotal: 0 });

const old = (path: string) => utimesSync(path, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
function write(root: string, rel: string, content: string) {
  const abs = join(root, ...rel.split('/'));
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
  old(abs);
  return abs;
}
async function until(check: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); }
}

describe('BackupEngine', () => {
  let root: string, indexDir: string, server: FakeServer, engines: BackupEngine[];
  const engine = (extra: Partial<ConstructorParameters<typeof BackupEngine>[0]> = {}) => {
    const e = new BackupEngine({ transport: server, indexDir, settleMs: 0, rescanMs: 0, watch: false, offlineRetryMs: 50, ...extra });
    engines.push(e);
    return e;
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hdb-src-'));
    indexDir = mkdtempSync(join(tmpdir(), 'hdb-idx-'));
    server = new FakeServer();
    engines = [];
  });
  afterEach(() => {
    engines.forEach((e) => e.stop());
    rmSync(root, { recursive: true, force: true });
    rmSync(indexDir, { recursive: true, force: true });
  });

  it('backs up every file with its folder structure on the first pass, then reports the totals', async () => {
    write(root, 'a.txt', 'aaa');
    write(root, 'Reports/2026/q1.xlsx', '12345');
    write(root, 'Reports/notes.md', 'n');
    const e = engine();
    e.setSources([source(1, root)]);
    await until(() => server.statuses.length === 1);
    expect(server.starts.map((s) => s.relativePath).sort()).toEqual(['Reports/2026/q1.xlsx', 'Reports/notes.md', 'a.txt']);
    expect(server.uploads).toHaveLength(3);
    expect(server.statuses[0]).toEqual([1, 3, 9]);
    const q1 = server.starts.find((s) => s.relativePath === 'Reports/2026/q1.xlsx')!;
    expect(q1.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(q1.idempotencyKey).toMatch(/^bk-[0-9a-f]{40}$/);
    expect(e.snapshot().activity.map((a) => a.kind)).toEqual(['uploaded', 'uploaded', 'uploaded']);
  });

  it('skips unchanged files on later passes and after a restart, and sends changed ones as new versions', async () => {
    write(root, 'a.txt', 'aaa');
    const first = engine();
    first.setSources([source(1, root)]);
    await until(() => server.statuses.length === 1);
    first.backUpNow();
    await until(() => server.statuses.length === 2);
    expect(server.starts).toHaveLength(1);
    first.stop();

    const second = engine(); // same index folder: nothing to ask the server about
    second.setSources([source(1, root)]);
    await until(() => server.statuses.length === 3);
    expect(server.starts).toHaveLength(1);

    write(root, 'a.txt', 'aaaa, changed');
    second.backUpNow();
    await until(() => server.uploads.length === 2);
    await second.idle();
    expect(second.snapshot().activity[0]).toMatchObject({ kind: 'updated', relativePath: 'a.txt' });
  });

  it('ignores system junk and skips names HarDisk cannot store', async () => {
    write(root, '.DS_Store', 'x');
    write(root, '~$draft.docx', 'x');
    write(root, 'what?.txt', 'x');
    write(root, 'ok.txt', 'x');
    const e = engine();
    e.setSources([source(1, root)]);
    await until(() => server.statuses.length === 1);
    expect(server.starts.map((s) => s.relativePath)).toEqual(['ok.txt']);
    expect(e.snapshot().activity.find((a) => a.kind === 'skipped')?.relativePath).toBe('what?.txt');
  });

  it('waits and retries when the server cannot be reached', async () => {
    write(root, 'a.txt', 'aaa');
    server.failNext = new ApiError(0, "Can't reach HarDisk");
    const e = engine();
    e.setSources([source(1, root)]);
    await until(() => e.snapshot().status === 'offline' || server.uploads.length === 1);
    await until(() => server.uploads.length === 1);
    expect(server.starts).toHaveLength(2);
  });

  it('records refusals and retries conflicts later instead of failing silently', async () => {
    write(root, 'a.txt', 'aaa');
    server.failNext = new ApiError(403, 'Cannot update files', 'Ask for editor access.');
    const e = engine();
    e.setSources([source(1, root)]);
    await until(() => e.snapshot().activity.length === 1);
    expect(e.snapshot().activity[0]).toMatchObject({ kind: 'failed', message: 'Cannot update files: Ask for editor access.' });
    expect(server.uploads).toHaveLength(0);
  });

  it('marks folders that are not on this computer', async () => {
    const e = engine();
    e.setSources([source(1, join(root, 'missing'))]);
    await until(() => e.snapshot().sources[0]?.error != null);
    expect(e.snapshot().sources[0]).toMatchObject({ available: false });
  });

  it('a parent folder that takes over a backed-up child does not announce the child’s unchanged files again', async () => {
    write(root, 'Desktop/test/a.txt', 'aaa');
    write(root, 'Desktop/test/sub/b.txt', 'bb');
    write(root, 'Desktop/notes.txt', 'n');
    const e = engine();
    e.setSources([source(1, join(root, 'Desktop', 'test'))]);
    await until(() => server.statuses.length === 1);
    expect(server.starts.map((s) => s.relativePath).sort()).toEqual(['a.txt', 'sub/b.txt']);

    e.adoptIndex(1, 2, 'test');
    e.forgetSource(1);
    e.setSources([source(2, join(root, 'Desktop'))]);
    await until(() => server.statuses.length === 2);
    expect(server.starts.slice(2).map((s) => s.relativePath)).toEqual(['notes.txt']);
  });

  it('picks up new files from the file watcher', async () => {
    const e = engine({ watch: true, settleMs: 30 });
    e.setSources([source(1, root)]);
    await until(() => server.statuses.length === 1);
    write(root, 'later/new.txt', 'fresh');
    await until(() => server.uploads.includes('1:later/new.txt'), 8000);
  });
});
