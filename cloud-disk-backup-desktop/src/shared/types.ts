/** Types shared by the Electron main process, the preload bridge and the window. Type-only: no runtime code. */

export interface Account {
  id: number;
  email: string;
  displayName: string | null;
  organizationName: string | null;
}

export interface DriveOption {
  id: number;
  letter: string;
  name: string;
  freeBytes: number;
  allocatedBytes: number;
  myPermission: 'VIEWER' | 'CONTRIBUTOR' | 'EDITOR' | 'MANAGER';
  canUpdate: boolean;
}

export interface SourceInfo {
  id: number;
  deviceId: number;
  name: string;
  localPath: string;
  /** Where it sits under the device folder: its full local path ("Users/me/Desktop/test"); null for older sources. */
  remotePath: string | null;
  folderId: number | null;
  createdAt: string;
  lastBackupAt: string | null;
  filesCount: number;
  bytesTotal: number;
}

export interface DeviceInfo {
  id: number;
  deviceKey: string;
  name: string;
  platform: string | null;
  driveId: number;
  driveLetter: string;
  driveName: string;
  folderId: number | null;
  folderPath: string;
  createdAt: string;
  lastSeenAt: string;
  sources: SourceInfo[];
}

export type EngineStatus = 'idle' | 'scanning' | 'uploading' | 'paused' | 'offline' | 'error';

export interface SourceState {
  id: number;
  name: string;
  localPath: string;
  /** False when the folder does not exist on this computer (e.g. a device continued from another computer). */
  available: boolean;
  scanning: boolean;
  filesSeen: number;
  bytesSeen: number;
  pending: number;
  lastBackupAt: string | null;
  error: string | null;
}

export interface TransferState {
  sourceId: number;
  relativePath: string;
  sizeBytes: number;
  sentBytes: number;
}

export type ActivityKind = 'uploaded' | 'updated' | 'skipped' | 'failed';

export interface ActivityItem {
  id: string;
  at: string;
  sourceId: number;
  sourceName: string;
  relativePath: string;
  kind: ActivityKind;
  sizeBytes: number;
  message?: string;
}

export interface EngineSnapshot {
  status: EngineStatus;
  message: string | null;
  queued: number;
  transfers: TransferState[];
  sources: SourceState[];
  activity: ActivityItem[];
  uploadedFiles: number;
  uploadedBytes: number;
}

/** A disk of this computer, offered for "entire computer" backup. */
export interface ComputerDisk { path: string; name: string }

/** Specific folders the member picked, or every disk of the computer (system files and apps skipped). */
export type BackupMode = 'folders' | 'computer';

export interface Settings {
  apiBaseUrl: string;
  openAtLogin: boolean;
  paused: boolean;
}

// ---- CCTV cloud recording ----

/** How the stream address of a channel is built: brand presets, or a full RTSP address with {channel}. */
export type RecorderBrand = 'hikvision' | 'dahua' | 'uniview' | 'custom';
/** Main stream (full quality) or sub stream (lower resolution, much less upload). */
export type StreamQuality = 'main' | 'sub';

/** How to reach an NVR/DVR on the local network. The password stays on this computer (encrypted). */
export interface RecorderConnection {
  brand: RecorderBrand;
  host: string;
  port: number;
  username: string;
  /** Only sent from the window when entered; never sent back to it. */
  password?: string;
  stream: StreamQuality;
  /** For 'custom': rtsp://host:554/path?ch={channel} — user and password are added from the fields above. */
  urlTemplate: string | null;
}

export interface CameraSettings { id: number; channel: number; name: string; enabled: boolean }

export interface RecorderInfo extends Omit<RecorderConnection, 'password'> {
  id: number;
  name: string;
  driveId: number;
  driveLetter: string;
  driveName: string;
  folderPath: string;
  timeZone: string;
  /** 0 keeps recordings forever. */
  retentionDays: number;
  canSetRetention: boolean;
  hasPassword: boolean;
  cameras: CameraSettings[];
}

export interface NewRecorder extends RecorderConnection {
  name: string;
  driveId: number;
  retentionDays: number;
  cameras: { channel: number; name: string }[];
}

export interface RecorderPatch {
  name?: string;
  retentionDays?: number;
  connection?: RecorderConnection;
}

export type CameraState = 'starting' | 'recording' | 'reconnecting' | 'error' | 'stopped';

export interface CameraLive {
  id: number;
  state: CameraState;
  message: string | null;
  /** End of the newest clip that is safely in the cloud: how far behind live the cloud copy is. */
  cloudUpTo: string | null;
  queuedClips: number;
  uploadedClips: number;
  uploadedBytes: number;
  /** Measured from the last clips (bits per second), so the upload needed can be judged. */
  bitrate: number;
}

export interface CctvActivity { id: string; at: string; cameraId: number; cameraName: string; kind: 'uploaded' | 'failed' | 'info'; message: string; sizeBytes: number }

export interface CctvSnapshot {
  ffmpegPath: string | null;
  cameras: CameraLive[];
  /** Clips waiting on this computer (offline or slow upload). */
  spoolBytes: number;
  activity: CctvActivity[];
}

/** Everything the window needs to draw itself. */
export interface AppState {
  phase: 'signed-out' | 'setup' | 'ready';
  account: Account | null;
  device: DeviceInfo | null;
  computerName: string;
  platform: string;
  /** Derived from the device's folders: 'computer' when its folders are this computer's disks. */
  backupMode: BackupMode;
  settings: Settings;
  /** CCTV recorders of the signed-in member recorded from this computer. */
  recorders: RecorderInfo[];
}

export interface ApiErrorInfo {
  status: number;
  message: string;
  description?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiErrorInfo };

/** The API the preload script exposes as `window.hardisk`. */
export interface HarDiskBridge {
  getState(): Promise<AppState>;
  signIn(email: string, password: string, apiBaseUrl: string): Promise<Result<AppState>>;
  signOut(): Promise<AppState>;
  listDrives(): Promise<Result<DriveOption[]>>;
  listDevices(): Promise<Result<DeviceInfo[]>>;
  /** New device on this computer (deviceKey omitted) or continue an existing device (its key). */
  useDevice(driveId: number, name: string, deviceKey?: string): Promise<Result<AppState>>;
  /** Leave the current device on this computer and choose again (nothing is deleted). */
  changeDevice(): Promise<AppState>;
  chooseFolder(): Promise<string | null>;
  /** Folder picker that allows selecting several folders at once. */
  chooseFolders(): Promise<string[]>;
  addFolders(localPaths: string[]): Promise<Result<AppState>>;
  computerDisks(): Promise<ComputerDisk[]>;
  /**
   * 'computer' replaces the selected folders with every disk; 'folders' stops backing up the disks (pick folders after).
   * Files already backed up always stay in HarDisk.
   */
  setBackupMode(mode: BackupMode): Promise<Result<AppState>>;
  locateFolder(sourceId: number, localPath: string): Promise<Result<AppState>>;
  removeFolder(sourceId: number): Promise<Result<AppState>>;
  backUpNow(): Promise<void>;
  setPaused(paused: boolean): Promise<AppState>;
  setOpenAtLogin(open: boolean): Promise<AppState>;
  openPath(localPath: string): Promise<void>;
  openWeb(): Promise<void>;
  getSnapshot(): Promise<EngineSnapshot>;
  // CCTV
  /** Grabs one frame from a channel to check the address, user and password (a JPEG data URL). */
  cctvTest(connection: RecorderConnection, channel: number, recorderId?: number): Promise<Result<string>>;
  cctvPreview(cameraId: number): Promise<Result<string>>;
  cctvAddRecorder(recorder: NewRecorder): Promise<Result<AppState>>;
  cctvUpdateRecorder(recorderId: number, patch: RecorderPatch): Promise<Result<AppState>>;
  cctvRemoveRecorder(recorderId: number): Promise<Result<AppState>>;
  cctvAddCamera(recorderId: number, channel: number, name: string): Promise<Result<AppState>>;
  cctvUpdateCamera(cameraId: number, patch: { name?: string; enabled?: boolean }): Promise<Result<AppState>>;
  cctvRemoveCamera(cameraId: number): Promise<Result<AppState>>;
  /** Picks the ffmpeg program by hand when it is not found automatically. */
  cctvChooseFfmpeg(): Promise<CctvSnapshot>;
  cctvSnapshot(): Promise<CctvSnapshot>;
  onCctv(listener: (snapshot: CctvSnapshot) => void): () => void;
  onSnapshot(listener: (snapshot: EngineSnapshot) => void): () => void;
  onState(listener: (state: AppState) => void): () => void;
}
