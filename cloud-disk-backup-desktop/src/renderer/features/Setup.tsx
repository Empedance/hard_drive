import { useEffect, useMemo, useState } from 'react';
import { Cctv, ChevronRight, FolderOpen, FolderPlus, HardDrive, LaptopMinimal, LogOut, MonitorCheck, MonitorSmartphone, TriangleAlert, X } from 'lucide-react';
import type { AppState, BackupMode, ComputerDisk, DeviceInfo, DriveOption } from '../../shared/types';
import { bridge } from '../app/bridge';
import { stateReceived, useAppDispatch, viewChanged } from '../app/store';
import { formatBytes, timeAgo } from '../app/format';
import { Brand } from '../components/Brand';

/** First run after signing in: which drive receives the backup, and whether this is a new device or an existing one. */
export function Setup({ state }: { state: AppState }) {
  const dispatch = useAppDispatch();
  const [drives, setDrives] = useState<DriveOption[] | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [driveId, setDriveId] = useState<number | null>(null);
  const [mode, setMode] = useState<'new' | number>('new');
  const [name, setName] = useState(state.computerName);
  const [what, setWhat] = useState<BackupMode | 'cameras'>('folders');
  const [folders, setFolders] = useState<string[]>([]);
  const [disks, setDisks] = useState<ComputerDisk[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void bridge.listDrives().then((r) => {
      if (!r.ok) { setError(r.error.message); setDrives([]); return; }
      setDrives(r.value);
      if (r.value.length > 0) setDriveId((current) => current ?? r.value[0]!.id);
    });
    void bridge.listDevices().then((r) => { if (r.ok) setDevices(r.value); });
    void bridge.computerDisks().then(setDisks);
  }, []);

  const drive = drives?.find((d) => d.id === driveId) ?? null;
  const onDrive = useMemo(() => devices.filter((d) => d.driveId === driveId), [devices, driveId]);
  const chosen = typeof mode === 'number' ? onDrive.find((d) => d.id === mode) ?? null : null;
  // Continuing a device keeps whatever it already backs up; the choice below is for new devices.
  const needsChoice = chosen == null;

  async function pickFolders() {
    const picked = await bridge.chooseFolders();
    if (picked.length) setFolders((current) => [...current, ...picked.filter((p) => !current.includes(p))]);
  }

  async function start() {
    if (!drive) return;
    setBusy(true);
    setError(null);
    let r = await bridge.useDevice(drive.id, chosen ? chosen.name : name, chosen?.deviceKey);
    // CCTV only: no folders now; cameras are added on the Cameras page (folders can be added later as well).
    if (r.ok && needsChoice && what !== 'cameras') r = what === 'computer' ? await bridge.setBackupMode('computer') : await bridge.addFolders(folders);
    setBusy(false);
    if (r.ok && what === 'cameras') dispatch(viewChanged('cameras'));
    if (r.ok) dispatch(stateReceived(r.value));
    else setError([r.error.message, r.error.description].filter(Boolean).join(' — '));
  }

  return (
    <main className="setup">
      <header className="setup__top drag">
        <Brand small />
        <div className="account-chip no-drag">
          <span className="avatar">{(state.account?.displayName ?? state.account?.email ?? '?').slice(0, 1).toUpperCase()}</span>
          <span><strong>{state.account?.displayName ?? state.account?.email}</strong><small>{state.account?.organizationName}</small></span>
          <button className="icon-btn" title="Sign out" aria-label="Sign out" onClick={() => void bridge.signOut().then((s) => dispatch(stateReceived(s)))}><LogOut size={16} /></button>
        </div>
      </header>

      <div className="setup__body">
        <div className="setup__intro">
          <p className="eyebrow">Set up backup</p>
          <h1>Where should this computer back up to?</h1>
          <p className="muted">A <strong>Backup</strong> folder is created in the drive you choose, with a folder for this computer inside it.</p>
        </div>

        <section className="step">
          <h2><span className="step__n">1</span> Choose a drive</h2>
          {drives == null && <div className="skeleton-row"><span /><span /></div>}
          {drives?.length === 0 && (
            <p className="alert"><TriangleAlert size={16} /> You have no drive you can upload to. Ask your organization’s admin to give you access to a drive.</p>
          )}
          <div className="drive-grid" role="radiogroup" aria-label="Drive">
            {drives?.map((d) => {
              const used = d.allocatedBytes > 0 ? 1 - d.freeBytes / d.allocatedBytes : 0;
              return (
                <button key={d.id} role="radio" aria-checked={d.id === driveId} className={`drive-card${d.id === driveId ? ' is-selected' : ''}`}
                  onClick={() => { setDriveId(d.id); setMode('new'); }}>
                  <span className="drive-card__letter"><HardDrive size={18} />{d.letter}:</span>
                  <span className="drive-card__name">{d.name}</span>
                  <span className="bar"><span style={{ width: `${Math.min(100, used * 100)}%` }} /></span>
                  <span className="drive-card__meta">{formatBytes(d.freeBytes)} free of {formatBytes(d.allocatedBytes)}</span>
                  {!d.canUpdate && <span className="drive-card__note">You can add files here, but changed files can’t be updated.</span>}
                </button>
              );
            })}
          </div>
        </section>

        {drive && (
          <section className="step">
            <h2><span className="step__n">2</span> This computer</h2>
            <div className="device-options" role="radiogroup" aria-label="Device">
              <label className={`device-option${mode === 'new' ? ' is-selected' : ''}`}>
                <input type="radio" name="device" checked={mode === 'new'} onChange={() => setMode('new')} />
                <LaptopMinimal size={22} className="device-option__icon" />
                <span className="device-option__text">
                  <strong>Back up as a new device</strong>
                  <input className="inline-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onFocus={() => setMode('new')} aria-label="Device name" />
                </span>
              </label>
              {onDrive.map((d) => (
                <label key={d.id} className={`device-option${mode === d.id ? ' is-selected' : ''}`}>
                  <input type="radio" name="device" checked={mode === d.id} onChange={() => setMode(d.id)} />
                  <MonitorSmartphone size={22} className="device-option__icon" />
                  <span className="device-option__text">
                    <strong>Continue “{d.name}”</strong>
                    <small>{d.sources.length} folder{d.sources.length === 1 ? '' : 's'} · last active {timeAgo(d.lastSeenAt)}</small>
                  </span>
                </label>
              ))}
            </div>
            <p className="path-preview">
              <span>{drive.letter}:</span><ChevronRight size={14} /><span>Backup</span><ChevronRight size={14} />
              <strong>{chosen ? chosen.folderPath.replace(/^Backup\//, '') : `${name || 'Computer'} (…)`}</strong>
            </p>
          </section>
        )}

        {drive && needsChoice && (
          <section className="step">
            <h2><span className="step__n">3</span> What to back up</h2>
            <div className="what-grid" role="radiogroup" aria-label="What to back up">
              <button role="radio" aria-checked={what === 'folders'} className={`what-card${what === 'folders' ? ' is-selected' : ''}`} onClick={() => setWhat('folders')}>
                <span className="what-card__icon"><FolderOpen size={22} /></span>
                <strong>Specific folders</strong>
                <span>Only the folders you choose, with everything inside them.</span>
              </button>
              <button role="radio" aria-checked={what === 'computer'} className={`what-card${what === 'computer' ? ' is-selected' : ''}`} onClick={() => setWhat('computer')}>
                <span className="what-card__icon what-card__icon--violet"><MonitorCheck size={22} /></span>
                <strong>Entire computer</strong>
                <span>All your disks. System files, apps and caches are skipped.</span>
              </button>
              <button role="radio" aria-checked={what === 'cameras'} className={`what-card${what === 'cameras' ? ' is-selected' : ''}`} onClick={() => setWhat('cameras')}>
                <span className="what-card__icon what-card__icon--red"><Cctv size={22} /></span>
                <strong>CCTV cameras</strong>
                <span>Record an NVR/DVR’s cameras live to the cloud. Add folders later if you like.</span>
              </button>
            </div>
            {what === 'cameras' ? (
              <div className="picked">
                <small className="muted">Next you’ll connect to the recorder on this network (IP address, user and password) and choose the cameras.
                  Recordings go to <strong>CCTV</strong> in the drive you choose there.</small>
              </div>
            ) : what === 'folders' ? (
              <div className="picked">
                {folders.map((f) => (
                  <span key={f} className="picked__item" title={f}>
                    <FolderOpen size={15} /><bdi dir="ltr">{f}</bdi>
                    <button className="icon-btn" aria-label={`Remove ${f}`} onClick={() => setFolders((c) => c.filter((x) => x !== f))}><X size={14} /></button>
                  </span>
                ))}
                <button className="btn btn--ghost" onClick={() => void pickFolders()}><FolderPlus size={16} /> {folders.length ? 'Add more folders' : 'Choose folders…'}</button>
                <small className="muted">You can choose several folders at once, and add or remove folders later.</small>
              </div>
            ) : (
              <div className="picked">
                {disks.map((d) => <span key={d.path} className="picked__item"><HardDrive size={15} /> {d.name} <small className="muted">{d.path}</small></span>)}
                <small className="muted">Each disk gets its own folder in the backup.{state.platform === 'darwin' ? ' To include protected folders (Mail, Messages, other users), allow HarDisk Backup under System Settings › Privacy & Security › Full Disk Access.' : ''}</small>
              </div>
            )}
          </section>
        )}

        {error && <p className="alert" role="alert">{error}</p>}
        <div className="setup__actions">
          <button className="btn btn--primary" disabled={!drive || busy || (mode === 'new' && !name.trim()) || (needsChoice && what === 'folders' && folders.length === 0)} onClick={() => void start()}>
            {busy ? <span className="spinner spinner--light" /> : needsChoice && what === 'cameras' ? 'Continue' : 'Start backup'}
          </button>
        </div>
      </div>
    </main>
  );
}
