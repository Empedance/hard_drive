import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { safeStorage as SafeStorage } from 'electron';
import { ApiError, type ApiClient, type RecorderRecord } from '../api';
import type { NewRecorder, RecorderConnection, RecorderInfo, RecorderPatch } from '../../shared/types';
import type { CctvEngine } from './engine';
import { explainFfmpegError, snapshotArgs } from './ffmpeg';
import { redact, streamUrl } from './streams';

interface StoredCamera { id: number; channel: number; enabled: boolean }

/** What this computer keeps about a recorder it records: how to reach it, and the server's last answer. */
interface StoredRecorder {
  userId: number;
  id: number;
  connection: Omit<RecorderConnection, 'password'>;
  /** Encrypted with the OS keychain; null when none was given. */
  password: string | null;
  cameras: StoredCamera[];
  server: RecorderRecord;
}

const MAX_CHANNELS = 64;

/**
 * CCTV recorders recorded from this computer, for the signed-in member. Connection details and passwords never leave
 * this computer (passwords are encrypted with the OS keychain); the server knows the recorder, its cameras and clips.
 */
export class CctvManager {
  private all: StoredRecorder[] = [];
  private userId: number | null = null;

  constructor(private readonly path: string, private readonly api: ApiClient, private readonly engine: CctvEngine,
              private readonly safe: typeof SafeStorage, private readonly onChange: () => void) {
    try { this.all = (JSON.parse(readFileSync(path, 'utf8')) as { recorders: StoredRecorder[] }).recorders ?? []; } catch { this.all = []; }
  }

  private get mine(): StoredRecorder[] { return this.all.filter((r) => r.userId === this.userId); }

  recorders(): RecorderInfo[] {
    return this.mine.map((r) => ({
      ...r.connection, id: r.id, name: r.server.name, driveId: r.server.driveId, driveLetter: r.server.driveLetter, driveName: r.server.driveName,
      folderPath: r.server.folderPath, timeZone: r.server.timeZone, retentionDays: r.server.retentionDays, canSetRetention: r.server.canSetRetention,
      hasPassword: r.password != null,
      cameras: r.cameras.map((c) => ({ id: c.id, channel: c.channel, enabled: c.enabled, name: r.server.cameras.find((x) => x.id === c.id)?.name ?? `Camera ${c.channel}` }))
        .sort((a, b) => a.channel - b.channel),
    }));
  }

  /** After sign-in: starts recording this member's recorders, refreshed from the server (removed ones are dropped). */
  async signedIn(userId: number): Promise<void> {
    this.userId = userId;
    this.apply();
    try {
      const server = await this.api.cctvRecorders();
      for (const r of this.mine) {
        const fresh = server.find((s) => s.id === r.id);
        if (!fresh) { this.all = this.all.filter((x) => x !== r); continue; }
        r.server = fresh;
        r.cameras = r.cameras.filter((c) => fresh.cameras.some((x) => x.id === c.id));
      }
      this.save();
      this.apply();
    } catch (error) {
      if (!(error instanceof ApiError && error.offline)) throw error; // offline: keep recording what we know
    }
  }

  signedOut(): void {
    this.userId = null;
    this.engine.setCameras([]);
  }

  async add(input: NewRecorder): Promise<void> {
    const userId = this.requireUser();
    const connection = this.connectionOf(input);
    const channels = this.channels(input.cameras.map((c) => c.channel));
    // Checks the address can be built before anything is created on the server.
    streamUrl(connection, channels[0] ?? 1, input.password ?? '');
    const server = await this.api.registerRecorder({ driveId: input.driveId, recorderKey: randomUUID().replace(/-/g, ''), name: input.name.trim() || 'Recorder',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', retentionDays: input.retentionDays });
    const stored: StoredRecorder = { userId, id: server.id, connection, password: this.encrypt(input.password), cameras: [], server };
    this.all.push(stored);
    for (const c of input.cameras) await this.addCameraTo(stored, c.channel, c.name);
    this.save();
    this.apply();
  }

  async update(recorderId: number, patch: RecorderPatch): Promise<void> {
    const r = this.own(recorderId);
    if (patch.name != null || patch.retentionDays != null) r.server = await this.api.updateRecorder(r.id, { name: patch.name?.trim() || undefined, retentionDays: patch.retentionDays });
    if (patch.connection) {
      const connection = this.connectionOf(patch.connection);
      streamUrl(connection, r.cameras[0]?.channel ?? 1, patch.connection.password ?? this.decrypt(r.password));
      r.connection = connection;
      if (patch.connection.password != null) r.password = this.encrypt(patch.connection.password);
    }
    this.save();
    this.apply();
  }

  /** Stops recording it here and forgets it on the server; recordings already uploaded stay in the drive. */
  async remove(recorderId: number): Promise<void> {
    const r = this.own(recorderId);
    await this.api.forgetRecorder(r.id).catch((error: unknown) => { if (!(error instanceof ApiError && error.status === 404)) throw error; });
    this.all = this.all.filter((x) => x !== r);
    this.save();
    this.apply();
    for (const c of r.cameras) await this.engine.forget(c.id);
  }

  async addCamera(recorderId: number, channel: number, name: string): Promise<void> {
    const r = this.own(recorderId);
    this.channels([channel]);
    if (r.cameras.some((c) => c.channel === channel)) throw new ApiError(409, 'Channel already added', `Channel ${channel} is already recorded.`);
    await this.addCameraTo(r, channel, name);
    this.save();
    this.apply();
  }

  async updateCamera(cameraId: number, patch: { name?: string; enabled?: boolean }): Promise<void> {
    const { r, c } = this.ownCamera(cameraId);
    if (patch.name?.trim()) {
      const renamed = await this.api.renameCamera(cameraId, patch.name.trim());
      r.server = { ...r.server, cameras: r.server.cameras.map((x) => (x.id === cameraId ? renamed : x)) };
    }
    if (patch.enabled != null) c.enabled = patch.enabled;
    this.save();
    this.apply();
  }

  async removeCamera(cameraId: number): Promise<void> {
    const { r } = this.ownCamera(cameraId);
    await this.api.removeCamera(cameraId).catch((error: unknown) => { if (!(error instanceof ApiError && error.status === 404)) throw error; });
    r.cameras = r.cameras.filter((c) => c.id !== cameraId);
    r.server = { ...r.server, cameras: r.server.cameras.filter((c) => c.id !== cameraId) };
    this.save();
    this.apply();
    await this.engine.forget(cameraId);
  }

  /** One frame from a channel: proves the address, user and password work. */
  test(connection: RecorderConnection, channel: number, recorderId?: number): Promise<string> {
    const stored = recorderId != null ? this.own(recorderId) : null;
    const password = connection.password ?? (stored ? this.decrypt(stored.password) : '');
    return this.grab(streamUrl(this.connectionOf(connection), channel, password));
  }

  preview(cameraId: number): Promise<string> {
    const { r, c } = this.ownCamera(cameraId);
    return this.grab(streamUrl(r.connection, c.channel, this.decrypt(r.password)));
  }

  // ---- internals ----

  private async addCameraTo(r: StoredRecorder, channel: number, name: string): Promise<void> {
    const camera = await this.api.addCamera(r.id, `ch${channel}`, name.trim() || `Camera ${channel}`);
    r.cameras.push({ id: camera.id, channel, enabled: true });
    r.server = { ...r.server, cameras: [...r.server.cameras.filter((x) => x.id !== camera.id), camera] };
  }

  /** Tells the engine which cameras to record now. */
  private apply(): void {
    const jobs = this.mine.flatMap((r) => r.cameras.filter((c) => c.enabled).flatMap((c) => {
      try {
        return [{ id: c.id, name: r.server.cameras.find((x) => x.id === c.id)?.name ?? `Camera ${c.channel}`, url: streamUrl(r.connection, c.channel, this.decrypt(r.password)) }];
      } catch { return []; }
    }));
    this.engine.setCameras(jobs);
    this.onChange();
  }

  private grab(url: string): Promise<string> {
    const ffmpeg = this.engine.ffmpeg;
    if (!ffmpeg) return Promise.reject(new ApiError(400, 'ffmpeg not found', 'Install ffmpeg, or choose where it is, to connect to cameras.'));
    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpeg, snapshotArgs(url), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const chunks: Buffer[] = [];
      let stderr = '';
      const timer = setTimeout(() => proc.kill('SIGKILL'), 20_000);
      proc.stdout.on('data', (b: Buffer) => chunks.push(b));
      proc.stderr.on('data', (b: Buffer) => { stderr = (stderr + b.toString()).slice(-4000); });
      proc.on('error', (e) => { clearTimeout(timer); reject(new ApiError(400, 'ffmpeg could not start', e.message)); });
      proc.on('exit', (code) => {
        clearTimeout(timer);
        const jpeg = Buffer.concat(chunks);
        if (code === 0 && jpeg.length > 0) resolve(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
        else reject(new ApiError(400, 'Could not connect to the camera', redact(explainFfmpegError(redact(stderr || 'timed out')))));
      });
    });
  }

  private connectionOf(c: RecorderConnection): Omit<RecorderConnection, 'password'> {
    return { brand: c.brand, host: c.host.trim(), port: Number(c.port) || 554, username: c.username.trim(), stream: c.stream === 'sub' ? 'sub' : 'main',
      urlTemplate: c.brand === 'custom' ? (c.urlTemplate ?? '').trim() : null };
  }

  private channels(list: number[]): number[] {
    for (const ch of list) if (!Number.isInteger(ch) || ch < 1 || ch > MAX_CHANNELS) throw new ApiError(400, 'Invalid channel', `Channels are numbered 1 to ${MAX_CHANNELS}.`);
    if (new Set(list).size !== list.length) throw new ApiError(400, 'Channel listed twice');
    return list;
  }

  private requireUser(): number {
    if (this.userId == null) throw new ApiError(401, 'Signed out', 'Sign in again.');
    return this.userId;
  }

  private own(recorderId: number): StoredRecorder {
    const r = this.mine.find((x) => x.id === recorderId);
    if (!r) throw new ApiError(404, 'Recorder not found');
    return r;
  }

  private ownCamera(cameraId: number): { r: StoredRecorder; c: StoredCamera } {
    for (const r of this.mine) { const c = r.cameras.find((x) => x.id === cameraId); if (c) return { r, c }; }
    throw new ApiError(404, 'Camera not found');
  }

  private encrypt(password: string | undefined): string | null {
    if (!password) return null;
    if (!this.safe.isEncryptionAvailable())
      throw new ApiError(400, 'Cannot store the password safely', 'This computer has no keychain to encrypt the recorder password with.');
    return this.safe.encryptString(password).toString('base64');
  }

  private decrypt(stored: string | null): string {
    if (!stored) return '';
    try { return this.safe.decryptString(Buffer.from(stored, 'base64')); } catch { return ''; }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path + '.tmp', JSON.stringify({ recorders: this.all }, null, 2), { mode: 0o600 });
    renameSync(this.path + '.tmp', this.path);
  }
}
