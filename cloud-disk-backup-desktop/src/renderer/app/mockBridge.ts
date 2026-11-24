import type { AppState, CameraLive, CctvSnapshot, ComputerDisk, DeviceInfo, DriveOption, EngineSnapshot, HarDiskBridge, RecorderInfo, SourceInfo } from '../../shared/types';

/**
 * Browser-only stand-in for the Electron main process (see bridge.ts). Sign in with any email and password; it
 * pretends to back up a few files so every state of the screens can be seen. Never used inside the desktop app.
 */
export function createMockBridge(): HarDiskBridge {
  const drives: DriveOption[] = [
    { id: 4, letter: 'D', name: 'Niyam’s drive', freeBytes: 9.2e12, allocatedBytes: 11e12, myPermission: 'MANAGER', canUpdate: true },
    { id: 7, letter: 'E', name: 'Design team', freeBytes: 1.4e12, allocatedBytes: 2e12, myPermission: 'CONTRIBUTOR', canUpdate: false },
  ];
  const otherDevice: DeviceInfo = { id: 11, deviceKey: 'office-desktop-key', name: 'OFFICE-PC', platform: 'win32', driveId: 4, driveLetter: 'D', driveName: 'Niyam’s drive',
    folderId: 90, folderPath: 'Backup/OFFICE-PC (9c41e2d0)', createdAt: '2026-10-02T09:00:00Z', lastSeenAt: new Date(Date.now() - 86400e3 * 3).toISOString(),
    sources: [{ id: 31, deviceId: 11, name: 'Projects', localPath: 'C:\\Users\\niyam\\Projects', remotePath: 'C/Users/niyam/Projects', folderId: 91, createdAt: '2026-10-02T09:00:00Z', lastBackupAt: null, filesCount: 820, bytesTotal: 4.1e9 }] };

  let state: AppState = { phase: 'signed-out', account: null, device: null, computerName: 'Niyams-MacBook-Pro', platform: 'darwin', backupMode: 'folders',
    settings: { apiBaseUrl: 'http://localhost:8080/api/v1', openAtLogin: false, paused: false }, recorders: [] };
  let snapshot: EngineSnapshot = { status: 'idle', message: null, queued: 0, transfers: [], sources: [], activity: [], uploadedFiles: 0, uploadedBytes: 0 };
  const stateListeners = new Set<(s: AppState) => void>();
  const snapshotListeners = new Set<(s: EngineSnapshot) => void>();
  let nextId = 100;
  const disks: ComputerDisk[] = [{ path: '/', name: 'Macintosh HD' }, { path: '/Volumes/Photos SSD', name: 'Photos SSD' }];
  const newSource = (name: string, localPath: string): SourceInfo => ({ id: nextId++, deviceId: state.device!.id, name, localPath, remotePath: localPath.split('/').filter(Boolean).join('/'), folderId: nextId++,
    createdAt: new Date().toISOString(), lastBackupAt: null, filesCount: 0, bytesTotal: 0 });

  let cctv: CctvSnapshot = { ffmpegPath: '/opt/homebrew/bin/ffmpeg', cameras: [], spoolBytes: 0, activity: [] };
  const cctvListeners = new Set<(s: CctvSnapshot) => void>();
  const setCctv = (patch: Partial<CctvSnapshot>) => { cctv = { ...cctv, ...patch }; cctvListeners.forEach((l) => l(cctv)); };
  // A test card instead of a camera picture.
  const picture = (label: string) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#26406e"/><stop offset="1" stop-color="#0d1730"/></linearGradient></defs>
    <rect width="640" height="360" fill="url(#g)"/><rect x="40" y="220" width="560" height="100" fill="#1b2a4a"/><circle cx="520" cy="90" r="40" fill="#f6c453" opacity="0.8"/>
    <text x="24" y="40" fill="#fff" font-family="monospace" font-size="20">${label}  ${new Date().toLocaleString()}</text></svg>`);
  function syncCameras() {
    const ids = new Set(state.recorders.flatMap((r) => r.cameras.filter((c) => c.enabled).map((c) => c.id)));
    const cameras: CameraLive[] = [...ids].map((id) => cctv.cameras.find((c) => c.id === id) ?? { id, state: 'starting', message: null, cloudUpTo: null, queuedClips: 1, uploadedClips: 0, uploadedBytes: 0, bitrate: 0 });
    setCctv({ cameras });
  }
  setInterval(() => {
    if (!cctv.cameras.length) return;
    const now = new Date();
    setCctv({ cameras: cctv.cameras.map((c, i) => (i === 2 ? { ...c, state: 'reconnecting', message: 'The recorder is not reachable on the network.' }
      : { ...c, state: 'recording', message: null, cloudUpTo: new Date(now.getTime() - 9_000 - (i * 1700)).toISOString(), uploadedClips: c.uploadedClips + 1, uploadedBytes: c.uploadedBytes + 2.4e6,
        bitrate: 1.9e6 + i * 2.1e5 })),
      activity: [{ id: String(nextId++), at: now.toISOString(), cameraId: cctv.cameras[0]!.id, cameraName: 'Front gate', kind: 'uploaded' as const,
        message: `CCTV/Shop NVR (5d2e8a10)/Front gate/${now.toISOString().slice(0, 10)}/${String(now.getHours()).padStart(2, '0')}/clip.mp4`, sizeBytes: 2.4e6 }, ...cctv.activity].slice(0, 20) });
  }, 4000);
  const setRecorders = (recorders: RecorderInfo[]) => { const s = setState({ recorders }); syncCameras(); return s; };

  const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; stateListeners.forEach((l) => l(state)); return state; };
  const setSnapshot = (patch: Partial<EngineSnapshot>) => { snapshot = { ...snapshot, ...patch }; snapshotListeners.forEach((l) => l(snapshot)); };
  const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function syncSources() {
    setSnapshot({ sources: (state.device?.sources ?? []).map((s) => ({ id: s.id, name: s.name, localPath: s.localPath, available: !s.localPath.startsWith('C:'),
      scanning: false, filesSeen: s.filesCount, bytesSeen: s.bytesTotal, pending: 0, lastBackupAt: s.lastBackupAt,
      error: s.localPath.startsWith('C:') ? 'This folder is not on this computer. Choose where it is, or remove it.' : null })) });
  }

  async function simulate(source: SourceInfo) {
    const files = ['Invoices/2026/october.pdf', 'Invoices/2026/november.pdf', 'Photos/trip/beach.jpg', 'Photos/trip/sunset.heic', 'notes.md', 'Budget.xlsx'];
    setSnapshot({ status: 'uploading', queued: files.length });
    for (const [i, rel] of files.entries()) {
      const size = 2e5 + Math.round(Math.random() * 8e6);
      for (let sent = 0; sent <= size; sent += size / 4) {
        setSnapshot({ queued: files.length - i - 1, transfers: [{ sourceId: source.id, relativePath: rel, sizeBytes: size, sentBytes: Math.min(sent, size) }] });
        await wait(160);
      }
      setSnapshot({ uploadedFiles: snapshot.uploadedFiles + 1, uploadedBytes: snapshot.uploadedBytes + size,
        activity: [{ id: String(nextId++), at: new Date().toISOString(), sourceId: source.id, sourceName: source.name, relativePath: rel, kind: i === 4 ? 'updated' : 'uploaded', sizeBytes: size }, ...snapshot.activity] });
    }
    const updated = { ...source, filesCount: files.length + 140, bytesTotal: 2.3e9, lastBackupAt: new Date().toISOString() };
    if (state.device) setState({ device: { ...state.device, sources: state.device.sources.map((s) => (s.id === source.id ? updated : s)) } });
    syncSources();
    setSnapshot({ status: state.settings.paused ? 'paused' : 'idle', transfers: [], queued: 0 });
  }

  return {
    getState: () => Promise.resolve(state),
    async signIn(email) {
      await wait(500);
      return ok(setState({ phase: 'setup', account: { id: 1, email, displayName: 'Niyam Rai', organizationName: 'ABC' } }));
    },
    signOut: () => Promise.resolve(setState({ phase: 'signed-out', account: null, device: null })),
    listDrives: () => ok(drives),
    listDevices: () => ok([otherDevice]),
    async useDevice(driveId, name, deviceKey) {
      await wait(400);
      const drive = drives.find((d) => d.id === driveId)!;
      const device: DeviceInfo = deviceKey === otherDevice.deviceKey ? otherDevice : { id: 12, deviceKey: 'this-mac', name, platform: 'darwin', driveId, driveLetter: drive.letter,
        driveName: drive.name, folderId: 95, folderPath: `Backup/${name} (3f031a8a)`, createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), sources: [] };
      const s = setState({ phase: 'ready', device });
      syncSources();
      return ok(s);
    },
    changeDevice: () => Promise.resolve(setState({ phase: 'setup', device: null })),
    chooseFolder: () => Promise.resolve(window.prompt('Folder to back up', '/Users/niyam/Documents')),
    chooseFolders: () => {
      const answer = window.prompt('Folders to back up (separate with ;)', '/Users/niyam/Documents;/Users/niyam/Pictures');
      return Promise.resolve(answer ? answer.split(';').map((x) => x.trim()).filter(Boolean) : []);
    },
    computerDisks: () => Promise.resolve(disks),
    async addFolders(localPaths) {
      if (!state.device) throw new Error('no device');
      const added = localPaths.map((p) => newSource(p.split(/[\\/]/).filter(Boolean).pop() ?? 'Folder', p));
      const s = setState({ device: { ...state.device, sources: [...state.device.sources, ...added] } });
      syncSources();
      if (added[0]) void simulate(added[0]);
      return ok(s);
    },
    async setBackupMode(mode) {
      if (!state.device) throw new Error('no device');
      await wait(300);
      const sources = mode === 'computer' ? disks.map((d) => newSource(d.name, d.path)) : [];
      const s = setState({ backupMode: mode, device: { ...state.device, sources } });
      syncSources();
      if (sources[0]) void simulate(sources[0]);
      return ok(s);
    },
    async locateFolder(sourceId, localPath) {
      if (!state.device) throw new Error('no device');
      const s = setState({ device: { ...state.device, sources: state.device.sources.map((x) => (x.id === sourceId ? { ...x, localPath } : x)) } });
      syncSources();
      return ok(s);
    },
    async removeFolder(sourceId) {
      if (!state.device) throw new Error('no device');
      const s = setState({ device: { ...state.device, sources: state.device.sources.filter((x) => x.id !== sourceId) } });
      syncSources();
      return ok(s);
    },
    async backUpNow() { const first = state.device?.sources.find((s) => !s.localPath.startsWith('C:')); if (first) void simulate(first); },
    async setPaused(paused) { const s = setState({ settings: { ...state.settings, paused } }); setSnapshot({ status: paused ? 'paused' : 'idle' }); return s; },
    async setOpenAtLogin(openAtLogin) { return setState({ settings: { ...state.settings, openAtLogin } }); },
    async openPath() { /* nothing in the browser */ },
    async openWeb() { window.open('http://localhost:5173', '_blank'); },
    getSnapshot: () => Promise.resolve(snapshot),
    async cctvTest(_c, channel) { await wait(900); return ok(picture(`CH${channel}`)); },
    async cctvPreview(cameraId) { await wait(600); return ok(picture(`CAM ${cameraId}`)); },
    async cctvAddRecorder(input) {
      await wait(500);
      const drive = drives.find((d) => d.id === input.driveId)!;
      const names = ['Front gate', 'Cash counter', 'Back door', 'Store room', 'Parking', 'Office'];
      const r: RecorderInfo = { id: nextId++, name: input.name, brand: input.brand, host: input.host, port: input.port, username: input.username, stream: input.stream,
        urlTemplate: input.urlTemplate, driveId: drive.id, driveLetter: drive.letter, driveName: drive.name, folderPath: `CCTV/${input.name} (5d2e8a10)`, timeZone: 'Asia/Kolkata',
        retentionDays: input.retentionDays, canSetRetention: drive.myPermission === 'MANAGER', hasPassword: !!input.password,
        cameras: input.cameras.map((c, i) => ({ id: nextId++, channel: c.channel, name: names[i] ?? c.name, enabled: true })) };
      return ok(setRecorders([...state.recorders, r]));
    },
    async cctvUpdateRecorder(id, patch) {
      return ok(setRecorders(state.recorders.map((r) => (r.id === id ? { ...r, name: patch.name ?? r.name, retentionDays: patch.retentionDays ?? r.retentionDays,
        ...(patch.connection ? { ...patch.connection, password: undefined, hasPassword: r.hasPassword || !!patch.connection.password } : {}) } : r))));
    },
    async cctvRemoveRecorder(id) { return ok(setRecorders(state.recorders.filter((r) => r.id !== id))); },
    async cctvAddCamera(id, channel, name) {
      return ok(setRecorders(state.recorders.map((r) => (r.id === id ? { ...r, cameras: [...r.cameras, { id: nextId++, channel, name, enabled: true }] } : r))));
    },
    async cctvUpdateCamera(cameraId, patch) {
      return ok(setRecorders(state.recorders.map((r) => ({ ...r, cameras: r.cameras.map((c) => (c.id === cameraId ? { ...c, ...patch } : c)) }))));
    },
    async cctvRemoveCamera(cameraId) { return ok(setRecorders(state.recorders.map((r) => ({ ...r, cameras: r.cameras.filter((c) => c.id !== cameraId) })))); },
    async cctvChooseFfmpeg() { return cctv; },
    cctvSnapshot: () => Promise.resolve(cctv),
    onCctv(listener) { cctvListeners.add(listener); return () => cctvListeners.delete(listener); },
    onSnapshot(listener) { snapshotListeners.add(listener); return () => snapshotListeners.delete(listener); },
    onState(listener) { stateListeners.add(listener); return () => stateListeners.delete(listener); },
  };
}
