import { EventEmitter } from 'node:events';
import { watch, type FSWatcher } from 'node:fs';
import { lstat, opendir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError, type BackupFileRequest, type BackupFileResponse, type UploadSession } from '../api';
import type { ActivityItem, ActivityKind, EngineSnapshot, EngineStatus, SourceInfo, SourceState, TransferState } from '../../shared/types';
import { FileIndex } from './fileIndex';
import { contentTypeFor, idempotencyKey, isExcludedPath, isIgnored, nameProblem, relativePath } from './rules';

/** What the engine needs from the server; the app passes the API client, tests a fake. */
export interface BackupTransport {
  startFile(sourceId: number, request: BackupFileRequest): Promise<BackupFileResponse>;
  upload(session: UploadSession, absolutePath: string, sizeBytes: number, onProgress: (sent: number) => void): Promise<void>;
  recordStatus(sourceId: number, filesCount: number, bytesTotal: number): Promise<unknown>;
}

export interface EngineOptions {
  transport: BackupTransport;
  /** Where per-folder indexes are kept; null keeps them in memory only. */
  indexDir: string | null;
  concurrency?: number;
  /** Files modified more recently than this are left to settle before upload (still being written). */
  settleMs?: number;
  /** Full rescan interval: a safety net for changes the file watcher missed. 0 disables. */
  rescanMs?: number;
  watch?: boolean;
  /** Delay before retrying after the server could not be reached. */
  offlineRetryMs?: number;
}

interface Source {
  info: SourceInfo;
  index: FileIndex;
  watcher: FSWatcher | null;
  available: boolean;
  scanning: boolean;
  /** A full pass finished and its totals still need to be reported once the queue for this folder is empty. */
  reportPending: boolean;
  filesSeen: number;
  bytesSeen: number;
  error: string | null;
  debounce: Map<string, NodeJS.Timeout>;
}

interface Job { sourceId: number; rel: string; attempts: number }

const MAX_ACTIVITY = 100;
const key = (sourceId: number, rel: string) => `${sourceId}\u0000${rel}`;

/**
 * Keeps local folders backed up: a full pass when a folder is added or the app starts, then file-system events (with a
 * periodic rescan as a safety net). Each changed file is announced to the server, which answers CREATE, REPLACE or
 * UNCHANGED, and the bytes go straight to storage. Deleting a local file never deletes it from the backup.
 *
 * Emits `snapshot` (throttled) whenever what the window shows changes, and `auth-lost` when the session ended.
 */
export class BackupEngine extends EventEmitter {
  private readonly sources = new Map<number, Source>();
  private readonly queue = new Map<string, Job>();
  private readonly running = new Map<string, TransferState>();
  /** Jobs that changed again while uploading: run once more afterwards. */
  private readonly again = new Set<string>();
  private readonly activity: ActivityItem[] = [];
  private paused = false;
  private offlineUntil = 0;
  private blockedMessage: string | null = null;
  private uploadedFiles = 0;
  private uploadedBytes = 0;
  private stopped = false;
  private rescanTimer: NodeJS.Timeout | null = null;
  private wakeTimer: NodeJS.Timeout | null = null;
  private emitTimer: NodeJS.Timeout | null = null;
  private readonly concurrency: number;
  private readonly settleMs: number;
  private readonly offlineRetryMs: number;

  constructor(private readonly options: EngineOptions) {
    super();
    this.concurrency = options.concurrency ?? 3;
    this.settleMs = options.settleMs ?? 2000;
    this.offlineRetryMs = options.offlineRetryMs ?? 30_000;
    const rescan = options.rescanMs ?? 15 * 60_000;
    if (rescan > 0) {
      this.rescanTimer = setInterval(() => this.backUpNow(), rescan);
      this.rescanTimer.unref?.();
    }
  }

  /** Makes the engine back up exactly these folders: new ones get a full pass, removed ones stop (their files stay). */
  setSources(list: SourceInfo[]): void {
    const wanted = new Map(list.map((s) => [s.id, s]));
    for (const [id, source] of this.sources) {
      if (!wanted.has(id)) this.dropSource(id, source);
    }
    for (const info of list) {
      const existing = this.sources.get(info.id);
      if (existing && existing.info.localPath === info.localPath) { existing.info = info; continue; }
      if (existing) this.dropSource(info.id, existing, false);
      const source: Source = { info, index: existing?.index ?? FileIndex.forSource(this.options.indexDir, info.id), watcher: null, available: false,
        scanning: false, reportPending: false, filesSeen: 0, bytesSeen: 0, error: null, debounce: new Map() };
      this.sources.set(info.id, source);
      void this.startSource(source);
    }
    this.changed();
  }

  /** Forgets a folder that stopped being backed up, including its local index. */
  forgetSource(id: number): void {
    const source = this.sources.get(id);
    if (source) { this.dropSource(id, source); source.index.destroy(); }
    this.changed();
  }

  /**
   * Copies folder `fromId`'s index into folder `toId`'s under `prefix` (the old folder's path inside the new one). Call
   * before `setSources` adds `toId`, so its first pass already knows those files.
   */
  adoptIndex(fromId: number, toId: number, prefix: string): void {
    const from = this.sources.get(fromId)?.index ?? FileIndex.forSource(this.options.indexDir, fromId);
    const target = this.sources.get(toId)?.index ?? FileIndex.forSource(this.options.indexDir, toId);
    target.absorb(from, prefix);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.pump();
    this.changed();
  }

  /** Full pass over every folder now (also clears an offline wait). */
  backUpNow(): void {
    this.offlineUntil = 0;
    this.blockedMessage = null;
    for (const source of this.sources.values()) void this.startSource(source);
  }

  stop(): void {
    this.stopped = true;
    for (const [id, source] of this.sources) { this.dropSource(id, source, false); source.index.flush(); }
    this.sources.clear();
    this.queue.clear();
    if (this.rescanTimer) clearInterval(this.rescanTimer);
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    if (this.emitTimer) clearTimeout(this.emitTimer);
  }

  snapshot(): EngineSnapshot {
    const sources: SourceState[] = [...this.sources.values()].map((s) => ({
      id: s.info.id, name: s.info.name, localPath: s.info.localPath, available: s.available, scanning: s.scanning,
      filesSeen: s.filesSeen || s.info.filesCount, bytesSeen: s.bytesSeen || s.info.bytesTotal,
      pending: this.pendingFor(s.info.id), lastBackupAt: s.info.lastBackupAt, error: s.error,
    }));
    const offline = this.offlineUntil > Date.now();
    let status: EngineStatus = 'idle';
    if (this.paused) status = 'paused';
    else if (this.blockedMessage) status = 'error';
    else if (offline) status = 'offline';
    else if (this.running.size > 0 || this.queue.size > 0) status = 'uploading';
    else if (sources.some((s) => s.scanning)) status = 'scanning';
    return {
      status,
      message: this.blockedMessage ?? (offline ? "Can't reach HarDisk. Retrying shortly." : null),
      queued: this.queue.size,
      transfers: [...this.running.values()],
      sources,
      activity: [...this.activity],
      uploadedFiles: this.uploadedFiles,
      uploadedBytes: this.uploadedBytes,
    };
  }

  /** Resolves once nothing is queued, uploading or scanning (used by tests). */
  async idle(): Promise<void> {
    while (this.queue.size > 0 || this.running.size > 0 || [...this.sources.values()].some((s) => s.scanning)) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  // ---- folders ----

  private async startSource(source: Source): Promise<void> {
    if (this.stopped || source.scanning) return;
    const root = source.info.localPath;
    try {
      source.available = (await stat(root)).isDirectory();
    } catch {
      source.available = false;
    }
    if (!source.available) {
      source.error = 'This folder is not on this computer. Choose where it is, or remove it.';
      this.closeWatcher(source);
      this.changed();
      return;
    }
    source.error = null;
    if (this.options.watch !== false && !source.watcher) this.openWatcher(source);
    source.scanning = true;
    source.filesSeen = 0;
    source.bytesSeen = 0;
    this.changed();
    try {
      await this.scanDir(source, root, true);
      source.reportPending = true;
    } catch (error) {
      source.error = `Could not read the folder: ${(error as Error).message}`;
    } finally {
      source.scanning = false;
      this.maybeReport(source);
      this.changed();
    }
  }

  private async scanDir(source: Source, dir: string, counting: boolean): Promise<void> {
    let handle;
    try {
      handle = await opendir(dir);
    } catch (error) {
      if (dir === source.info.localPath) throw error;
      return; // a subfolder we may not read (permissions) or that just vanished
    }
    for await (const entry of handle) {
      if (this.stopped || !this.sources.has(source.info.id)) return;
      if (isIgnored(entry.name) || entry.isSymbolicLink()) continue;
      const abs = join(dir, entry.name);
      if (isExcludedPath(source.info.localPath, abs)) continue;
      if (entry.isDirectory()) await this.scanDir(source, abs, counting);
      else if (entry.isFile()) await this.consider(source, abs, counting);
    }
  }

  /** Queues the file when it is not in the index as it is now. */
  private async consider(source: Source, abs: string, counting: boolean): Promise<void> {
    let info;
    try { info = await stat(abs); } catch { return; }
    if (!info.isFile()) return;
    if (counting) { source.filesSeen += 1; source.bytesSeen += info.size; }
    const rel = relativePath(source.info.localPath, abs);
    if (source.index.matches(rel, info.size, info.mtimeMs)) return;
    this.enqueue(source.info.id, rel);
  }

  private openWatcher(source: Source): void {
    try {
      source.watcher = watch(source.info.localPath, { recursive: true, persistent: false }, (_event, filename) => {
        if (filename == null) { void this.startSource(source); return; }
        const rel = filename.toString().split(/[\\/]+/).join('/');
        // A whole disk produces a stream of system-file events: drop those before any timer is created.
        if (rel.split('/').some(isIgnored) || isExcludedPath(source.info.localPath, join(source.info.localPath, ...rel.split('/')))) return;
        const pending = source.debounce.get(rel);
        if (pending) clearTimeout(pending);
        source.debounce.set(rel, setTimeout(() => { source.debounce.delete(rel); void this.onChange(source, rel); }, 700));
      });
      source.watcher.on('error', () => this.closeWatcher(source)); // the periodic rescan still covers the folder
    } catch {
      source.watcher = null;
    }
  }

  private async onChange(source: Source, rel: string): Promise<void> {
    if (!this.sources.has(source.info.id) || rel.split('/').some(isIgnored)) return;
    const abs = join(source.info.localPath, ...rel.split('/'));
    if (isExcludedPath(source.info.localPath, abs)) return;
    let info;
    try { info = await lstat(abs); } catch { return; } // deleted locally: the backup keeps its copy
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) await this.scanDir(source, abs, false); // a folder moved or copied in
    else if (info.isFile()) await this.consider(source, abs, false);
  }

  private closeWatcher(source: Source): void {
    source.watcher?.close();
    source.watcher = null;
  }

  private dropSource(id: number, source: Source, remove = true): void {
    this.closeWatcher(source);
    source.debounce.forEach(clearTimeout);
    source.debounce.clear();
    for (const [k, job] of this.queue) if (job.sourceId === id) this.queue.delete(k);
    if (remove) this.sources.delete(id);
  }

  private maybeReport(source: Source): void {
    if (!source.reportPending || source.scanning || this.pendingFor(source.info.id) > 0) return;
    source.reportPending = false;
    const files = source.filesSeen, bytes = source.bytesSeen;
    this.options.transport.recordStatus(source.info.id, files, bytes).then(() => {
      source.info = { ...source.info, filesCount: files, bytesTotal: bytes, lastBackupAt: new Date().toISOString() };
      this.changed();
    }, () => { source.reportPending = true; });
  }

  private pendingFor(sourceId: number): number {
    let n = 0;
    for (const job of this.queue.values()) if (job.sourceId === sourceId) n++;
    for (const t of this.running.values()) if (t.sourceId === sourceId) n++;
    return n;
  }

  // ---- queue ----

  private enqueue(sourceId: number, rel: string, attempts = 0): void {
    const k = key(sourceId, rel);
    if (this.running.has(k)) { this.again.add(k); return; }
    if (!this.queue.has(k)) this.queue.set(k, { sourceId, rel, attempts });
    this.changed();
    this.pump();
  }

  private pump(): void {
    if (this.stopped || this.paused || this.blockedMessage) return;
    const wait = this.offlineUntil - Date.now();
    if (wait > 0) { this.wakeIn(wait); return; }
    while (this.running.size < this.concurrency && this.queue.size > 0) {
      const [k, job] = this.queue.entries().next().value as [string, Job];
      this.queue.delete(k);
      this.running.set(k, { sourceId: job.sourceId, relativePath: job.rel, sizeBytes: 0, sentBytes: 0 });
      void this.run(k, job).finally(() => {
        this.running.delete(k);
        const source = this.sources.get(job.sourceId);
        if (this.again.delete(k) && source) void this.consider(source, join(source.info.localPath, ...job.rel.split('/')), false);
        if (source) this.maybeReport(source);
        this.changed();
        this.pump();
      });
    }
  }

  private wakeIn(ms: number): void {
    if (this.wakeTimer) return;
    this.wakeTimer = setTimeout(() => { this.wakeTimer = null; this.changed(); this.pump(); }, ms);
    this.wakeTimer.unref?.();
  }

  private async run(k: string, job: Job): Promise<void> {
    const source = this.sources.get(job.sourceId);
    if (!source) return;
    const abs = join(source.info.localPath, ...job.rel.split('/'));
    let info;
    try { info = await stat(abs); } catch { return; }
    if (!info.isFile()) return;
    if (Date.now() - info.mtimeMs < this.settleMs) {
      // Still being written: look again shortly.
      setTimeout(() => { if (this.sources.has(job.sourceId)) this.enqueue(job.sourceId, job.rel, job.attempts); }, this.settleMs).unref?.();
      return;
    }
    if (source.index.matches(job.rel, info.size, info.mtimeMs)) return;
    const bad = job.rel.split('/').map(nameProblem).find((p) => p != null);
    if (bad) { this.record(source, job.rel, 'skipped', info.size, bad); source.index.set(job.rel, info.size, info.mtimeMs); return; }

    const transfer = this.running.get(k);
    if (transfer) transfer.sizeBytes = info.size;
    try {
      const started = await this.options.transport.startFile(job.sourceId, {
        relativePath: job.rel, sizeBytes: info.size, contentType: contentTypeFor(basename(abs)),
        modifiedAt: new Date(info.mtimeMs).toISOString(), idempotencyKey: idempotencyKey(job.sourceId, job.rel, info.size, info.mtimeMs),
      });
      if (started.action !== 'UNCHANGED' && started.upload) {
        await this.options.transport.upload(started.upload, abs, info.size, (sent) => {
          if (transfer) { transfer.sentBytes = sent; this.changed(); }
        });
        this.uploadedFiles += 1;
        this.uploadedBytes += info.size;
        this.record(source, job.rel, started.action === 'REPLACE' ? 'updated' : 'uploaded', info.size);
      }
      source.index.set(job.rel, info.size, info.mtimeMs);
    } catch (error) {
      this.failed(source, job, info.size, error);
    }
  }

  private failed(source: Source, job: Job, size: number, error: unknown): void {
    const api = error instanceof ApiError ? error : null;
    const retry = (ms: number) => setTimeout(() => this.enqueue(job.sourceId, job.rel, job.attempts + 1), ms).unref?.();
    if (api?.offline) {
      this.offlineUntil = Date.now() + this.offlineRetryMs;
      this.queue.set(key(job.sourceId, job.rel), { ...job });
      this.wakeIn(this.offlineRetryMs);
      return;
    }
    if (api?.status === 401) { this.queue.set(key(job.sourceId, job.rel), { ...job }); this.emit('auth-lost'); this.paused = true; return; }
    if (api?.status === 402) {
      this.blockedMessage = api.description ?? 'Your organization’s HarDisk access is blocked. Backup resumes once it is restored.';
      this.queue.set(key(job.sourceId, job.rel), { ...job });
      setTimeout(() => this.backUpNow(), 10 * 60_000).unref?.();
      return;
    }
    const message = api ? [api.message, api.description].filter(Boolean).join(': ') : (error as Error)?.message ?? 'Unknown error';
    this.record(source, job.rel, 'failed', size, message);
    // Conflicts (being edited, no space), throttling and server errors are retried with back-off; other refusals
    // (invalid name, no permission) wait for the next change or rescan.
    const transient = !api || api.status === 409 || api.status === 429 || api.status >= 500;
    if (transient && job.attempts < 6) retry(Math.min(60 * 60_000, 15_000 * 2 ** job.attempts));
  }

  private record(source: Source, rel: string, kind: ActivityKind, sizeBytes: number, message?: string): void {
    this.activity.unshift({ id: randomUUID(), at: new Date().toISOString(), sourceId: source.info.id, sourceName: source.info.name,
      relativePath: rel, kind, sizeBytes, message });
    if (this.activity.length > MAX_ACTIVITY) this.activity.length = MAX_ACTIVITY;
    this.changed();
  }

  private changed(): void {
    if (this.emitTimer || this.stopped) return;
    this.emitTimer = setTimeout(() => { this.emitTimer = null; this.emit('snapshot', this.snapshot()); }, 200);
    this.emitTimer.unref?.();
  }
}
