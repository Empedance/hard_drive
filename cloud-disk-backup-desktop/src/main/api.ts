import type { Account, ApiErrorInfo, DeviceInfo, DriveOption, SourceInfo } from '../shared/types';

/** A failed API call. `status` 0 means the server could not be reached. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly description?: string, readonly code?: string) {
    super(message);
  }
  get offline(): boolean { return this.status === 0; }
  info(): ApiErrorInfo { return { status: this.status, message: this.message, description: this.description }; }
}

/** Where the refresh token is kept between launches (encrypted by the OS keychain in the app). */
export interface TokenStore {
  load(): string | null;
  save(token: string | null): void;
}

export interface UploadSession {
  id: number;
  nodeId: number;
  mode: 'SINGLE' | 'MULTIPART';
  partSize: number;
  partCount: number;
  uploadUrl: string | null;
  contentType: string;
  expiresAt: string;
}

export interface BackupFileResponse {
  action: 'CREATE' | 'REPLACE' | 'UNCHANGED';
  nodeId: number;
  upload: UploadSession | null;
}

export interface BackupFileRequest {
  relativePath: string;
  sizeBytes: number;
  contentType?: string;
  modifiedAt?: string;
  idempotencyKey?: string;
}

/** A CCTV recorder as the server keeps it (connection details live only on the recording computer). */
export interface RecorderRecord {
  id: number;
  recorderKey: string;
  name: string;
  driveId: number;
  driveLetter: string;
  driveName: string;
  folderId: number | null;
  folderPath: string;
  timeZone: string;
  retentionDays: number;
  canSetRetention: boolean;
  cameras: CameraRecord[];
}

export interface CameraRecord { id: number; recorderId: number; cameraKey: string; name: string; lastClipAt: string | null; clipsCount: number; bytesTotal: number; state: string }

export interface ClipRequest { startedAt: string; durationMs: number; sizeBytes: number; contentType: string; idempotencyKey: string }
export interface ClipResponse { nodeId: number; path: string | null; upload: UploadSession | null }

type Fetch = typeof fetch;
interface Envelope<T> { status: boolean; data: T; error: { message: string; description?: string; code?: string } | null }

const REFRESH_COOKIE = 'cd_refresh';

/** The refresh token from the login/refresh response's Set-Cookie header (the API never puts it in the body). */
export function refreshTokenFrom(headers: Headers): string | null {
  const cookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie') ?? ''];
  for (const cookie of cookies) {
    const first = cookie.split(';')[0]?.trim() ?? '';
    if (first.startsWith(REFRESH_COOKIE + '=')) {
      const value = first.slice(REFRESH_COOKIE.length + 1);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/**
 * HarDisk REST client for the main process. Access tokens live only in memory; the refresh token is rotated on every
 * refresh and persisted through `TokenStore`. Concurrent 401s share one refresh, because replaying a rotated refresh
 * token makes the server revoke every session of the user.
 */
export class ApiClient {
  private accessToken: string | null = null;
  private refreshing: Promise<void> | null = null;
  onSignedOut: (() => void) | null = null;

  constructor(public baseUrl: string, private readonly tokens: TokenStore, private readonly fetchImpl: Fetch = fetch) {}

  get hasSession(): boolean { return this.tokens.load() != null; }

  async login(email: string, password: string): Promise<void> {
    const res = await this.raw('POST', '/auth/login', { email, password });
    const body = await this.envelope<{ accessToken: string | null; mfa: unknown }>(res);
    if (!body.accessToken)
      throw new ApiError(403, 'This account needs a second sign-in step', 'Platform accounts cannot back up files. Sign in with your organization account.');
    this.accessToken = body.accessToken;
    this.tokens.save(refreshTokenFrom(res.headers));
  }

  async logout(): Promise<void> {
    const token = this.tokens.load();
    this.accessToken = null;
    this.tokens.save(null);
    if (token) await this.raw('POST', '/auth/logout', { refreshToken: token }).catch(() => undefined);
  }

  /** Signs in again with the stored refresh token (app start, or an expired access token). */
  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const token = this.tokens.load();
        if (!token) throw new ApiError(401, 'Signed out', 'Sign in again.');
        const res = await this.raw('POST', '/auth/refresh', { refreshToken: token });
        if (res.status === 401 || res.status === 403) {
          this.accessToken = null;
          this.tokens.save(null);
          this.onSignedOut?.();
        }
        const body = await this.envelope<{ accessToken: string }>(res);
        this.accessToken = body.accessToken;
        const next = refreshTokenFrom(res.headers);
        if (next) this.tokens.save(next);
      })().finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.accessToken) await this.refresh();
    let res = await this.raw(method, path, body, this.accessToken);
    if (res.status === 401) {
      await this.refresh();
      res = await this.raw(method, path, body, this.accessToken);
    }
    return this.envelope<T>(res);
  }

  // ---- typed calls ----

  async me(): Promise<Account> {
    const me = await this.request<{ id: number; email: string; displayName: string | null; organization: { name: string } | null }>('GET', '/auth/me');
    return { id: me.id, email: me.email, displayName: me.displayName, organizationName: me.organization?.name ?? null };
  }
  drives(): Promise<DriveOption[]> { return this.request('GET', '/backup/drives'); }
  devices(): Promise<DeviceInfo[]> { return this.request('GET', '/backup/devices'); }
  registerDevice(driveId: number, deviceKey: string, name: string, platform: string): Promise<DeviceInfo> {
    return this.request('POST', '/backup/devices', { driveId, deviceKey, name, platform });
  }
  deviceSeen(deviceId: number, name: string, platform: string): Promise<DeviceInfo> {
    return this.request('PUT', `/backup/devices/${deviceId}/seen`, { name, platform });
  }
  addSource(deviceId: number, name: string, localPath: string, remotePath: string): Promise<SourceInfo> {
    return this.request('POST', `/backup/devices/${deviceId}/sources`, { name, localPath, remotePath });
  }
  moveSource(sourceId: number, localPath: string): Promise<SourceInfo> {
    return this.request('PATCH', `/backup/sources/${sourceId}`, { localPath });
  }
  removeSource(sourceId: number): Promise<void> { return this.request('DELETE', `/backup/sources/${sourceId}`); }
  backupFile(sourceId: number, request: BackupFileRequest): Promise<BackupFileResponse> {
    return this.request('POST', `/backup/sources/${sourceId}/files`, request);
  }
  recordStatus(sourceId: number, filesCount: number, bytesTotal: number): Promise<SourceInfo> {
    return this.request('PUT', `/backup/sources/${sourceId}/status`, { filesCount, bytesTotal });
  }
  cctvRecorders(): Promise<RecorderRecord[]> { return this.request('GET', '/cctv/recorders'); }
  registerRecorder(body: { driveId: number; recorderKey: string; name: string; timeZone: string; retentionDays: number }): Promise<RecorderRecord> {
    return this.request('POST', '/cctv/recorders', body);
  }
  updateRecorder(recorderId: number, body: { name?: string; timeZone?: string; retentionDays?: number }): Promise<RecorderRecord> {
    return this.request('PATCH', `/cctv/recorders/${recorderId}`, body);
  }
  forgetRecorder(recorderId: number): Promise<void> { return this.request('DELETE', `/cctv/recorders/${recorderId}`); }
  addCamera(recorderId: number, cameraKey: string, name: string): Promise<CameraRecord> {
    return this.request('POST', `/cctv/recorders/${recorderId}/cameras`, { cameraKey, name });
  }
  renameCamera(cameraId: number, name: string): Promise<CameraRecord> { return this.request('PATCH', `/cctv/cameras/${cameraId}`, { name }); }
  removeCamera(cameraId: number): Promise<void> { return this.request('DELETE', `/cctv/cameras/${cameraId}`); }
  startClip(cameraId: number, clip: ClipRequest): Promise<ClipResponse> { return this.request('POST', `/cctv/cameras/${cameraId}/clips`, clip); }
  cameraStatus(cameraId: number, state: string, message: string | null): Promise<CameraRecord> {
    return this.request('PUT', `/cctv/cameras/${cameraId}/status`, { state, message });
  }
  partUrls(uploadId: number, partNumbers: number[]): Promise<{ partNumber: number; url: string }[]> {
    return this.request('POST', `/uploads/${uploadId}/parts`, { partNumbers });
  }
  completeUpload(uploadId: number, parts?: { partNumber: number; etag: string }[]): Promise<unknown> {
    return this.request('POST', `/uploads/${uploadId}/complete`, parts ? { parts } : {});
  }
  abortUpload(uploadId: number): Promise<void> { return this.request('DELETE', `/uploads/${uploadId}`); }

  /** PUT bytes to a presigned storage URL (no API token); returns the ETag. */
  async putBytes(url: string, bytes: Uint8Array, contentType?: string): Promise<string | null> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: 'PUT', body: bytes, headers: contentType ? { 'Content-Type': contentType } : undefined });
    } catch {
      throw new ApiError(0, "Can't reach storage", 'Check your internet connection.');
    }
    if (!res.ok) throw new ApiError(res.status, 'Storage refused the upload', `HTTP ${res.status}`);
    return res.headers.get('etag');
  }

  // ---- plumbing ----

  private async raw(method: string, path: string, body?: unknown, token?: string | null): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      return await this.fetchImpl(this.baseUrl.replace(/\/+$/, '') + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, "Can't reach HarDisk", 'Check your internet connection and the server address.');
    }
  }

  private async envelope<T>(res: Response): Promise<T> {
    let parsed: Envelope<T> | null = null;
    try { parsed = (await res.json()) as Envelope<T>; } catch { /* not JSON */ }
    if (res.ok && parsed?.status) return parsed.data;
    const err = parsed?.error;
    throw new ApiError(res.status, err?.message ?? `Request failed (HTTP ${res.status})`, err?.description, err?.code);
  }
}
