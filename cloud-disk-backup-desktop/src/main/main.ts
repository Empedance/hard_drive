import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerSaveBlocker, safeStorage, shell, Tray } from 'electron';
import { existsSync, readdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, join, parse, relative, resolve, isAbsolute, sep } from 'node:path';
import { ApiClient, ApiError } from './api';
import { ConfigStore, SecureTokenStore } from './config';
import { BackupEngine } from './backup/engine';
import { uploadFile } from './backup/uploader';
import { remotePathFor } from './backup/rules';
import { CctvEngine } from './cctv/engine';
import { CctvManager } from './cctv/manager';
import { ffmpegCandidates, firstExecutable, verifyFfmpeg } from './cctv/ffmpeg';
import type { Account, AppState, BackupMode, CctvSnapshot, ComputerDisk, DeviceInfo, NewRecorder, RecorderConnection, RecorderPatch, Result } from '../shared/types';

const WEB_URL = process.env.HARDISK_WEB_URL ?? 'http://localhost:5173';
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const HEARTBEAT_MS = 10 * 60_000;

// A separate data folder (settings, session, indexes) for testing or a second profile.
if (process.env.HARDISK_USER_DATA) app.setPath('userData', process.env.HARDISK_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

const dataDir = app.getPath('userData');
const config = new ConfigStore(join(dataDir, 'config.json'));
const tokens = new SecureTokenStore(dataDir, safeStorage);
const api = new ApiClient(config.get().apiBaseUrl, tokens);
const engine = new BackupEngine({
  indexDir: join(dataDir, 'index'),
  transport: {
    startFile: (sourceId, request) => api.backupFile(sourceId, request),
    upload: (session, path, size, onProgress) => uploadFile(api, session, path, size, onProgress),
    recordStatus: (sourceId, files, bytes) => api.recordStatus(sourceId, files, bytes),
  },
});

// CCTV: cameras are recorded in short clips by ffmpeg and each clip is uploaded as soon as it closes.
const findFfmpeg = () => config.get().ffmpegPath ?? firstExecutable(ffmpegCandidates(process.platform, process.env, process.resourcesPath));
const cctvEngine = new CctvEngine({
  spoolDir: join(dataDir, 'cctv-clips'),
  ffmpegPath: findFfmpeg(),
  transport: {
    startClip: (cameraId, clip) => api.startClip(cameraId, clip),
    upload: (session, path, size) => uploadFile(api, session, path, size, () => undefined),
    reportStatus: (cameraId, s, message) => api.cameraStatus(cameraId, s, message),
  },
});
const cctv = new CctvManager(join(dataDir, 'cctv.json'), api, cctvEngine, safeStorage, () => publish());
let keepAwake: number | null = null;

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let account: Account | null = null;
let device: DeviceInfo | null = null;
let phase: AppState['phase'] = 'signed-out';
let heartbeat: NodeJS.Timeout | null = null;

const computerName = () => hostname().replace(/\.local$/i, '') || 'My computer';

function state(): AppState {
  const c = config.get();
  return { phase, account, device, computerName: computerName(), platform: process.platform, backupMode: backupMode(),
    settings: { apiBaseUrl: c.apiBaseUrl, openAtLogin: c.openAtLogin, paused: c.paused }, recorders: account ? cctv.recorders() : [] };
}

function publish(): AppState {
  const s = state();
  window?.webContents.send('state:changed', s);
  refreshTray();
  return s;
}

async function attempt<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.info() };
    return { ok: false, error: { status: -1, message: (error as Error).message ?? 'Something went wrong' } };
  }
}

// ---- session and device ----

function setDevice(next: DeviceInfo | null): void {
  device = next;
  phase = next ? 'ready' : account ? 'setup' : 'signed-out';
  engine.setSources(next ? next.sources : []);
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = next ? setInterval(() => void beat(), HEARTBEAT_MS) : null;
  publish();
}

/** Heartbeat; also picks up folders added or removed for this device from another computer. */
async function beat(): Promise<void> {
  if (!device) return;
  try { setDevice(await api.deviceSeen(device.id, computerName(), process.platform)); } catch { /* offline: try next time */ }
}

async function afterSignIn(): Promise<void> {
  account = await api.me();
  // Cameras record independently of file backup; a problem here never blocks signing in.
  await cctv.signedIn(account.id).catch((error: unknown) => console.error('CCTV start failed:', (error as Error).message));
  const choice = config.get().device;
  if (choice && choice.userId === account.id) {
    try {
      setDevice(await api.registerDevice(choice.driveId, choice.deviceKey, computerName(), process.platform));
      return;
    } catch (error) {
      if (error instanceof ApiError && error.offline) throw error;
      config.update({ device: null }); // the drive is gone or no longer writable: choose again
    }
  }
  setDevice(null);
}

async function boot(): Promise<void> {
  if (!api.hasSession) { publish(); return; }
  try {
    await afterSignIn();
  } catch (error) {
    if (error instanceof ApiError && error.offline) { setTimeout(() => void boot(), 30_000); return; }
    account = null;
    setDevice(null);
  }
}

api.onSignedOut = () => { account = null; cctv.signedOut(); setDevice(null); };
engine.on('auth-lost', () => { void api.refresh().then(() => engine.setPaused(config.get().paused), () => undefined); });
engine.on('snapshot', (snapshot) => { window?.webContents.send('engine:snapshot', snapshot); refreshTray(); });
engine.setPaused(config.get().paused);

// ---- folders ----

function folderName(localPath: string): string {
  const name = basename(localPath);
  if (name) return name;
  const root = parse(localPath).root.replace(/[\\/:]+/g, ''); // "D:\" → "D"
  return root ? `Drive ${root}` : 'Computer';
}

const inside = (parent: string, child: string) => { const r = relative(resolve(parent), resolve(child)); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

/**
 * The computer's disks for "entire computer" backup: Windows drive letters; on macOS the startup disk and other mounted
 * volumes; on Linux the root and mounted media. System areas inside them are skipped by the engine (rules.ts).
 */
function computerDisks(): ComputerDisk[] {
  const dirs = (parent: string) => {
    try { return readdirSync(parent, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.isSymbolicLink()).map((d) => d.name); } catch { return []; }
  };
  if (process.platform === 'win32') {
    return 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((l) => existsSync(`${l}:\\`)).map((l) => ({ path: `${l}:\\`, name: `Local Disk (${l})` }));
  }
  if (process.platform === 'darwin') {
    return [{ path: '/', name: 'Macintosh HD' }, ...dirs('/Volumes').map((n) => ({ path: `/Volumes/${n}`, name: n }))];
  }
  const user = process.env.USER ?? '';
  return [{ path: '/', name: 'Computer' }, ...dirs(`/media/${user}`).map((n) => ({ path: `/media/${user}/${n}`, name: n })),
    ...dirs('/mnt').map((n) => ({ path: `/mnt/${n}`, name: n }))];
}

/**
 * Adds folders (or disks) at their full path. One that contains folders already backed up on their own takes them over:
 * their index moves into the new folder's (their files sit at the same place in the drive), then they are removed as
 * separate folders, so nothing unchanged is uploaded again. Within one batch only the outermost folders are added.
 */
async function addCovering(items: { localPath: string; name: string }[]): Promise<void> {
  const outer = items.filter((a) => !items.some((b) => b !== a && resolve(b.localPath) !== resolve(a.localPath) && inside(b.localPath, a.localPath)));
  for (const item of outer) {
    if (!device) return;
    const children = device.sources.filter((s) => resolve(s.localPath) !== resolve(item.localPath) && inside(item.localPath, s.localPath));
    const created = await api.addSource(device.id, item.name, item.localPath, remotePathFor(item.localPath));
    const isNew = !device.sources.some((s) => s.id === created.id);
    for (const child of children) {
      // Older sources (no remotePath) lived elsewhere in the drive, so their files are uploaded again at the full path.
      if (isNew && child.remotePath != null) engine.adoptIndex(child.id, created.id, relative(item.localPath, child.localPath).split(sep).join('/'));
    }
    if (children.length) await dropSources(children.map((c) => c.id));
    replaceSource(created);
  }
}

const isDisk = (localPath: string) => computerDisks().some((d) => resolve(d.path) === resolve(localPath));

function backupMode(): BackupMode {
  const sources = device?.sources ?? [];
  return sources.length > 0 && sources.some((s) => isDisk(s.localPath)) ? 'computer' : 'folders';
}

async function dropSources(ids: number[]): Promise<void> {
  if (!device) return;
  for (const id of ids) { await api.removeSource(id); engine.forgetSource(id); }
  setDevice({ ...device, sources: device.sources.filter((s) => !ids.includes(s.id)) });
}

function replaceSource(source: DeviceInfo['sources'][number]): void {
  if (!device) return;
  const others = device.sources.filter((s) => s.id !== source.id);
  setDevice({ ...device, sources: [...others, source].sort((x, y) => x.name.localeCompare(y.name)) });
}

// ---- IPC ----

ipcMain.handle('state:get', () => state());
ipcMain.handle('engine:snapshot', () => engine.snapshot());

ipcMain.handle('auth:sign-in', (_e, email: string, password: string, apiBaseUrl: string) => attempt(async () => {
  const base = (apiBaseUrl || config.get().apiBaseUrl).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new ApiError(400, 'Invalid server address', 'Use an address like https://api.example.com/api/v1');
  config.update({ apiBaseUrl: base });
  api.baseUrl = base;
  await api.login(email.trim(), password);
  await afterSignIn();
  return state();
}));

ipcMain.handle('auth:sign-out', async () => {
  cctv.signedOut();
  await api.logout();
  account = null;
  setDevice(null);
  return state();
});

ipcMain.handle('backup:drives', () => attempt(() => api.drives()));
ipcMain.handle('backup:devices', () => attempt(() => api.devices()));

ipcMain.handle('backup:use-device', (_e, driveId: number, name: string, deviceKey?: string) => attempt(async () => {
  if (!account) throw new ApiError(401, 'Signed out', 'Sign in again.');
  const key = deviceKey ?? config.get().computerKey;
  const registered = await api.registerDevice(driveId, key, name?.trim() || computerName(), process.platform);
  config.update({ device: { userId: account.id, deviceId: registered.id, driveId, deviceKey: key } });
  setDevice(registered);
  return state();
}));

ipcMain.handle('backup:change-device', () => {
  config.update({ device: null });
  setDevice(null);
  return state();
});

ipcMain.handle('dialog:choose-folder', async () => {
  const options: Electron.OpenDialogOptions = { title: 'Choose a folder to back up', properties: ['openDirectory', 'createDirectory'] };
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle('dialog:choose-folders', async () => {
  const options: Electron.OpenDialogOptions = { title: 'Choose folders to back up', buttonLabel: 'Back up', properties: ['openDirectory', 'multiSelections', 'createDirectory'] };
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('backup:computer-disks', () => computerDisks());

ipcMain.handle('backup:add-folders', (_e, localPaths: string[]) => attempt(async () => {
  if (!device) throw new ApiError(400, 'Choose a device first');
  if (backupMode() === 'computer') throw new ApiError(409, 'Entire computer is backed up', 'Every folder is already included. Switch to “Selected folders” to pick folders instead.');
  for (const localPath of localPaths) if (!existsSync(localPath)) throw new ApiError(400, 'Folder not found', localPath);
  // A folder inside one that is already backed up is covered by it: nothing to add.
  const covered = localPaths.filter((p) => device!.sources.some((s) => inside(s.localPath, p)));
  const fresh = localPaths.filter((p) => !covered.includes(p));
  if (fresh.length === 0 && covered.length > 0) {
    const parent = device.sources.find((s) => inside(s.localPath, covered[0]!))!;
    throw new ApiError(409, 'Already backed up', `${covered[0]} is already included in ${parent.localPath}.`);
  }
  await addCovering(fresh.map((p) => ({ localPath: p, name: folderName(p) })));
  return state();
}));

ipcMain.handle('backup:set-mode', (_e, mode: BackupMode) => attempt(async () => {
  if (!device) throw new ApiError(400, 'Choose a device first');
  if (mode === backupMode()) return state();
  if (mode === 'computer') {
    // The disks contain the selected folders: those become part of them and keep what they already backed up.
    await addCovering(computerDisks().map((d) => ({ localPath: d.path, name: d.name })));
  } else {
    await dropSources(device.sources.filter((s) => isDisk(s.localPath)).map((s) => s.id));
  }
  return state();
}));

ipcMain.handle('backup:locate-folder', (_e, sourceId: number, localPath: string) => attempt(async () => {
  if (!existsSync(localPath)) throw new ApiError(400, 'Folder not found', localPath);
  replaceSource(await api.moveSource(sourceId, localPath));
  return state();
}));

ipcMain.handle('backup:remove-folder', (_e, sourceId: number) => attempt(async () => {
  if (!device) throw new ApiError(400, 'Choose a device first');
  await api.removeSource(sourceId);
  engine.forgetSource(sourceId);
  setDevice({ ...device, sources: device.sources.filter((s) => s.id !== sourceId) });
  return state();
}));

ipcMain.handle('backup:now', () => { engine.backUpNow(); void beat(); });
ipcMain.handle('settings:paused', (_e, paused: boolean) => { config.update({ paused }); engine.setPaused(paused); return publish(); });
ipcMain.handle('settings:open-at-login', (_e, open: boolean) => {
  config.update({ openAtLogin: open });
  app.setLoginItemSettings({ openAtLogin: open, args: ['--hidden'] });
  return publish();
});
ipcMain.handle('shell:open-path', (_e, localPath: string) => {
  // Only folders this device backs up can be opened.
  if (device?.sources.some((s) => s.localPath === localPath)) void shell.openPath(localPath);
});
ipcMain.handle('shell:open-web', () => shell.openExternal(WEB_URL));

// ---- CCTV ----

cctvEngine.on('snapshot', (snapshot: CctvSnapshot) => {
  window?.webContents.send('cctv:snapshot', snapshot);
  // Recording must not stop because the computer went to sleep.
  const recording = snapshot.cameras.some((c) => c.state !== 'stopped');
  if (recording && keepAwake == null) keepAwake = powerSaveBlocker.start('prevent-app-suspension');
  if (!recording && keepAwake != null) { powerSaveBlocker.stop(keepAwake); keepAwake = null; }
  refreshTray();
});
cctvEngine.on('auth-lost', () => { void api.refresh().catch(() => undefined); });

const changed = async (work: () => Promise<unknown>) => attempt(async () => { await work(); return state(); });
ipcMain.handle('cctv:snapshot', () => cctvEngine.snapshot());
ipcMain.handle('cctv:test', (_e, connection: RecorderConnection, channel: number, recorderId?: number) => attempt(() => cctv.test(connection, channel, recorderId)));
ipcMain.handle('cctv:preview', (_e, cameraId: number) => attempt(() => cctv.preview(cameraId)));
ipcMain.handle('cctv:add-recorder', (_e, recorder: NewRecorder) => changed(() => cctv.add(recorder)));
ipcMain.handle('cctv:update-recorder', (_e, id: number, patch: RecorderPatch) => changed(() => cctv.update(id, patch)));
ipcMain.handle('cctv:remove-recorder', (_e, id: number) => changed(() => cctv.remove(id)));
ipcMain.handle('cctv:add-camera', (_e, id: number, channel: number, name: string) => changed(() => cctv.addCamera(id, channel, name)));
ipcMain.handle('cctv:update-camera', (_e, id: number, patch: { name?: string; enabled?: boolean }) => changed(() => cctv.updateCamera(id, patch)));
ipcMain.handle('cctv:remove-camera', (_e, id: number) => changed(() => cctv.removeCamera(id)));
ipcMain.handle('cctv:choose-ffmpeg', async () => {
  const options: Electron.OpenDialogOptions = { title: 'Choose the ffmpeg program', buttonLabel: 'Use ffmpeg', properties: ['openFile'] };
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  const path = result.canceled ? null : result.filePaths[0] ?? null;
  if (path && await verifyFfmpeg(path)) {
    config.update({ ffmpegPath: path });
    cctvEngine.setFfmpeg(path);
  } else if (path) {
    await dialog.showMessageBox({ type: 'warning', message: 'That is not ffmpeg', detail: 'Choose the ffmpeg program itself (ffmpeg, or ffmpeg.exe on Windows).' });
  }
  return cctvEngine.snapshot();
});

// ---- window and tray ----

function assetPath(name: string): string { return join(__dirname, '..', '..', 'assets', name); }

function createWindow(show: boolean): void {
  window = new BrowserWindow({
    width: 1100, height: 740, minWidth: 900, minHeight: 620, show: false, title: 'HarDisk Backup',
    backgroundColor: '#f4f7fd',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 20 },
    icon: assetPath('icon.png'),
    webPreferences: { preload: join(__dirname, '..', 'preload', 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => { if (!DEV_URL || !url.startsWith(DEV_URL)) event.preventDefault(); });
  window.on('close', (event) => {
    // Closing the window keeps backing up in the background; quit from the tray or the app menu.
    if (!quitting) { event.preventDefault(); window?.hide(); }
  });
  window.once('ready-to-show', () => { if (show) window?.show(); });
  if (DEV_URL) void window.loadURL(DEV_URL);
  else void window.loadFile(join(__dirname, '..', '..', 'dist', 'index.html'));
}

function showWindow(): void {
  if (!window) createWindow(true);
  window?.show();
  window?.focus();
}

function refreshTray(): void {
  if (!tray) return;
  const snapshot = engine.snapshot();
  const paused = config.get().paused;
  const label = phase !== 'ready' ? 'Not set up' : snapshot.status === 'uploading' ? `Backing up · ${snapshot.queued + snapshot.transfers.length} left`
    : snapshot.status === 'paused' ? 'Paused' : snapshot.status === 'offline' ? 'Offline' : snapshot.status === 'error' ? 'Needs attention' : 'Up to date';
  const cameras = cctvEngine.snapshot().cameras;
  const recording = cameras.filter((c) => c.state === 'recording').length;
  tray.setToolTip(`HarDisk Backup — ${label}${cameras.length ? ` · ${recording}/${cameras.length} cameras recording` : ''}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label, enabled: false },
    ...(cameras.length ? [{ label: `Cameras: ${recording} of ${cameras.length} recording`, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Open HarDisk Backup', click: showWindow },
    { label: 'Back up now', enabled: phase === 'ready', click: () => engine.backUpNow() },
    { label: paused ? 'Resume backup' : 'Pause backup', enabled: phase === 'ready', click: () => { config.update({ paused: !paused }); engine.setPaused(!paused); publish(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

app.on('second-instance', showWindow);
app.on('activate', showWindow);
let cctvStopped = false;
app.on('before-quit', (event) => {
  quitting = true;
  engine.stop();
  if (cctvStopped) return;
  // Let ffmpeg close the clips it is writing; they upload on the next start.
  event.preventDefault();
  cctvStopped = true;
  void cctvEngine.stop().finally(() => app.quit());
});
app.on('window-all-closed', () => { /* keep running in the tray */ });

void app.whenReady().then(() => {
  const icon = nativeImage.createFromPath(assetPath(process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.on('click', showWindow);
  const hidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAsHidden;
  createWindow(!hidden);
  void boot();
});
