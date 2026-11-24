import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AppState, CctvSnapshot, EngineSnapshot, HarDiskBridge } from '../shared/types';

/** The only API the window gets: named calls into the main process, no Node.js access. */
const bridge: HarDiskBridge = {
  getState: () => ipcRenderer.invoke('state:get'),
  signIn: (email, password, apiBaseUrl) => ipcRenderer.invoke('auth:sign-in', email, password, apiBaseUrl),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  listDrives: () => ipcRenderer.invoke('backup:drives'),
  listDevices: () => ipcRenderer.invoke('backup:devices'),
  useDevice: (driveId, name, deviceKey) => ipcRenderer.invoke('backup:use-device', driveId, name, deviceKey),
  changeDevice: () => ipcRenderer.invoke('backup:change-device'),
  chooseFolder: () => ipcRenderer.invoke('dialog:choose-folder'),
  chooseFolders: () => ipcRenderer.invoke('dialog:choose-folders'),
  addFolders: (localPaths) => ipcRenderer.invoke('backup:add-folders', localPaths),
  computerDisks: () => ipcRenderer.invoke('backup:computer-disks'),
  setBackupMode: (mode) => ipcRenderer.invoke('backup:set-mode', mode),
  locateFolder: (sourceId, localPath) => ipcRenderer.invoke('backup:locate-folder', sourceId, localPath),
  removeFolder: (sourceId) => ipcRenderer.invoke('backup:remove-folder', sourceId),
  backUpNow: () => ipcRenderer.invoke('backup:now'),
  setPaused: (paused) => ipcRenderer.invoke('settings:paused', paused),
  setOpenAtLogin: (open) => ipcRenderer.invoke('settings:open-at-login', open),
  openPath: (localPath) => ipcRenderer.invoke('shell:open-path', localPath),
  openWeb: () => ipcRenderer.invoke('shell:open-web'),
  getSnapshot: () => ipcRenderer.invoke('engine:snapshot'),
  cctvTest: (connection, channel, recorderId) => ipcRenderer.invoke('cctv:test', connection, channel, recorderId),
  cctvPreview: (cameraId) => ipcRenderer.invoke('cctv:preview', cameraId),
  cctvAddRecorder: (recorder) => ipcRenderer.invoke('cctv:add-recorder', recorder),
  cctvUpdateRecorder: (recorderId, patch) => ipcRenderer.invoke('cctv:update-recorder', recorderId, patch),
  cctvRemoveRecorder: (recorderId) => ipcRenderer.invoke('cctv:remove-recorder', recorderId),
  cctvAddCamera: (recorderId, channel, name) => ipcRenderer.invoke('cctv:add-camera', recorderId, channel, name),
  cctvUpdateCamera: (cameraId, patch) => ipcRenderer.invoke('cctv:update-camera', cameraId, patch),
  cctvRemoveCamera: (cameraId) => ipcRenderer.invoke('cctv:remove-camera', cameraId),
  cctvChooseFfmpeg: () => ipcRenderer.invoke('cctv:choose-ffmpeg'),
  cctvSnapshot: () => ipcRenderer.invoke('cctv:snapshot'),
  onCctv: (listener) => {
    const handler = (_e: IpcRendererEvent, s: CctvSnapshot) => listener(s);
    ipcRenderer.on('cctv:snapshot', handler);
    return () => { ipcRenderer.removeListener('cctv:snapshot', handler); };
  },
  onSnapshot: (listener) => {
    const handler = (_e: IpcRendererEvent, s: EngineSnapshot) => listener(s);
    ipcRenderer.on('engine:snapshot', handler);
    return () => { ipcRenderer.removeListener('engine:snapshot', handler); };
  },
  onState: (listener) => {
    const handler = (_e: IpcRendererEvent, s: AppState) => listener(s);
    ipcRenderer.on('state:changed', handler);
    return () => { ipcRenderer.removeListener('state:changed', handler); };
  },
};

contextBridge.exposeInMainWorld('hardisk', bridge);
