import { useEffect, useState } from 'react';
import {
  Activity, ArrowUpFromLine, Info, MonitorCheck, ChevronRight, CircleAlert, CloudUpload, ExternalLink, FolderOpen, FolderPlus, Gauge, HardDrive, LayoutGrid,
  Cctv, LogOut, Pause, Play, RefreshCw, Settings as SettingsIcon, SkipForward, Trash2, type LucideIcon,
} from 'lucide-react';
import type { ActivityItem, AppState, EngineSnapshot, SourceState } from '../../shared/types';
import { bridge } from '../app/bridge';
import { stateReceived, useAppDispatch, useAppSelector, viewChanged, type View } from '../app/store';
import { formatBytes, formatCount, timeAgo } from '../app/format';
import { Brand } from '../components/Brand';
import { StatusOrb } from '../components/StatusOrb';
import { Cameras } from './Cameras';

const NAV: { id: View; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'cameras', label: 'Cameras', icon: Cctv },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

export function Dashboard({ state }: { state: AppState }) {
  const dispatch = useAppDispatch();
  const view = useAppSelector((s) => s.ui.view);
  const snapshot = useAppSelector((s) => s.engine);
  const cctv = useAppSelector((s) => s.cctv);
  const device = state.device!;
  // Re-render every 30 s so "5 min ago" stays true.
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__brand drag"><Brand small /></div>
        <div className="device-card">
          <span className="device-card__label">This device</span>
          <strong title={device.name}>{device.name}</strong>
          <span className="device-card__path"><HardDrive size={13} /> {device.driveLetter}: <ChevronRight size={12} /> {device.folderPath.replace('/', ' › ')}</span>
        </div>
        <nav className="nav">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav__item${view === id ? ' is-active' : ''}`} aria-current={view === id ? 'page' : undefined} onClick={() => dispatch(viewChanged(id))}>
              <Icon size={17} /> {label}
              {id === 'activity' && snapshot.activity.some((a) => a.kind === 'failed') && <span className="dot dot--warn" aria-label="has problems" />}
              {id === 'cameras' && cctv.cameras.some((c) => c.state === 'error' || c.state === 'reconnecting') && <span className="dot dot--warn" aria-label="cameras need attention" />}
              {id === 'cameras' && cctv.cameras.length > 0 && !cctv.cameras.some((c) => c.state === 'error' || c.state === 'reconnecting') && <span className="rec-dot" aria-label="recording" />}
            </button>
          ))}
        </nav>
        <div className="sidebar__foot">
          <span className="avatar">{(state.account?.displayName ?? state.account?.email ?? '?').slice(0, 1).toUpperCase()}</span>
          <span className="sidebar__who"><strong>{state.account?.displayName ?? state.account?.email}</strong><small>{state.account?.organizationName}</small></span>
          <button className="icon-btn" title="Sign out" aria-label="Sign out" onClick={() => void bridge.signOut().then((s) => dispatch(stateReceived(s)))}><LogOut size={16} /></button>
        </div>
      </aside>

      <main className="content">
        <div className="content__drag drag" />
        {view === 'overview' && <Overview state={state} snapshot={snapshot} />}
        {view === 'cameras' && <Cameras state={state} />}
        {view === 'activity' && <ActivityView items={snapshot.activity} />}
        {view === 'settings' && <SettingsView state={state} />}
      </main>
    </div>
  );
}

function headline(s: EngineSnapshot, folders: number): { title: string; sub: string } {
  const left = s.queued + s.transfers.length;
  switch (s.status) {
    case 'uploading': return { title: `Backing up ${formatCount(left)} file${left === 1 ? '' : 's'}`, sub: s.transfers[0] ? `Now: ${s.transfers[0].relativePath}` : 'Preparing…' };
    case 'scanning': return { title: 'Looking for changes', sub: 'Comparing your folders with the backup…' };
    case 'paused': return { title: 'Backup is paused', sub: 'New and changed files wait until you resume.' };
    case 'offline': return { title: 'Waiting for connection', sub: s.message ?? 'Backup continues when HarDisk is reachable.' };
    case 'error': return { title: 'Backup needs attention', sub: s.message ?? 'See Activity for details.' };
    default: return folders === 0 ? { title: 'Choose what to back up', sub: 'Everything inside it is backed up, and kept up to date.' }
      : { title: 'Everything is backed up', sub: 'New and changed files are uploaded automatically.' };
  }
}

function Overview({ state, snapshot }: { state: AppState; snapshot: EngineSnapshot }) {
  const dispatch = useAppDispatch();
  const device = state.device!;
  const [error, setError] = useState<string | null>(null);
  const sent = snapshot.transfers.reduce((a, t) => a + t.sentBytes, 0);
  const total = snapshot.transfers.reduce((a, t) => a + t.sizeBytes, 0);
  const progress = total > 0 ? sent / total : 0;
  const { title, sub } = headline(snapshot, device.sources.length);
  const sources: SourceState[] = device.sources.map((s) => snapshot.sources.find((x) => x.id === s.id) ?? {
    id: s.id, name: s.name, localPath: s.localPath, available: true, scanning: true, filesSeen: s.filesCount, bytesSeen: s.bytesTotal, pending: 0, lastBackupAt: s.lastBackupAt, error: null,
  });
  const files = sources.reduce((a, s) => a + s.filesSeen, 0);
  const bytes = sources.reduce((a, s) => a + s.bytesSeen, 0);

  async function run(work: Promise<{ ok: true; value: AppState } | { ok: false; error: { message: string; description?: string } }>) {
    setError(null);
    const r = await work;
    if (r.ok) dispatch(stateReceived(r.value));
    else setError([r.error.message, r.error.description].filter(Boolean).join(' — '));
  }
  async function addFolders() {
    const paths = await bridge.chooseFolders();
    if (paths.length) await run(bridge.addFolders(paths));
  }
  const computer = state.backupMode === 'computer';
  async function switchMode(mode: 'folders' | 'computer') {
    if (mode === state.backupMode) return;
    const ask = mode === 'computer'
      ? 'Back up the entire computer?\n\nAll your disks are backed up (system files, apps and caches are skipped). Your selected folders are included, so they stop being separate backups — what they already backed up stays in HarDisk.'
      : 'Back up only specific folders?\n\nThe disks stop being backed up (everything already backed up stays in HarDisk). Then choose the folders you want.';
    if (!window.confirm(ask)) return;
    await run(bridge.setBackupMode(mode));
    if (mode === 'folders') await addFolders();
  }
  async function locate(id: number) {
    const path = await bridge.chooseFolder();
    if (path) await run(bridge.locateFolder(id, path));
  }
  async function remove(s: SourceState) {
    if (window.confirm(`Stop backing up “${s.name}”?\n\nFiles already backed up stay in HarDisk.`)) await run(bridge.removeFolder(s.id));
  }

  return (
    <div className="page">
      <section className={`hero hero--${snapshot.status}`}>
        <StatusOrb status={snapshot.status} progress={progress} />
        <div className="hero__text">
          <h1>{title}</h1>
          <p className="hero__sub" title={sub}>{sub}</p>
          <p className="hero__dest"><CloudUpload size={15} /> {device.driveLetter}: {device.driveName} <ChevronRight size={13} /> {device.folderPath.replace('/', ' › ')}</p>
        </div>
        <div className="hero__actions">
          <button className="btn btn--ghost" onClick={() => void bridge.backUpNow()} disabled={state.settings.paused}><RefreshCw size={16} /> Back up now</button>
          <button className="btn btn--soft" onClick={() => void bridge.setPaused(!state.settings.paused).then((s) => dispatch(stateReceived(s)))}>
            {state.settings.paused ? <><Play size={16} /> Resume</> : <><Pause size={16} /> Pause</>}
          </button>
        </div>
      </section>

      <section className="stats">
        <Stat icon={FolderOpen} label="Folders" value={formatCount(device.sources.length)} />
        <Stat icon={HardDrive} label="Files protected" value={formatCount(files)} />
        <Stat icon={Gauge} label="Backup size" value={formatBytes(bytes)} />
        <Stat icon={ArrowUpFromLine} label="Uploaded this session" value={`${formatCount(snapshot.uploadedFiles)} · ${formatBytes(snapshot.uploadedBytes)}`} />
      </section>

      {snapshot.transfers.length > 0 && (
        <section className="panel">
          <h2 className="panel__title">Uploading now</h2>
          <ul className="transfers">
            {snapshot.transfers.map((t) => (
              <li key={`${t.sourceId}/${t.relativePath}`}>
                <span className="transfers__name" title={t.relativePath}>{t.relativePath}</span>
                <span className="transfers__size">{formatBytes(t.sentBytes)} / {formatBytes(t.sizeBytes)}</span>
                <span className="bar bar--thin"><span style={{ width: `${t.sizeBytes ? (t.sentBytes / t.sizeBytes) * 100 : 0}%` }} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="section-head">
          <h2>{computer ? 'Entire computer' : 'Backed-up folders'}</h2>
          <span className="muted">Everything inside, with the same folder structure</span>
          <div className="segmented" role="radiogroup" aria-label="What to back up">
            <button role="radio" aria-checked={!computer} onClick={() => void switchMode('folders')}><FolderOpen size={14} /> Selected folders</button>
            <button role="radio" aria-checked={computer} onClick={() => void switchMode('computer')}><MonitorCheck size={14} /> Entire computer</button>
          </div>
        </div>
        {computer && (
          <p className="note"><Info size={16} /><span>Every disk of this computer is backed up. System files, installed apps and caches are skipped.
            {state.platform === 'darwin' && ' For protected folders (Mail, Messages, other users), allow HarDisk Backup in System Settings › Privacy & Security › Full Disk Access.'}</span></p>
        )}
        {error && <p className="alert" role="alert">{error}</p>}
        <div className="folder-grid">
          {sources.map((s, i) => (
            <article key={s.id} className={`folder-card${s.error ? ' has-error' : ''}`} style={{ ['--hue' as string]: `${(i * 47 + 212) % 360}` }}>
              <div className="folder-card__top">
                <span className="folder-card__icon"><FolderOpen size={22} /></span>
                <div className="folder-card__menu">
                  {s.available && <button className="icon-btn" title="Show in folder" aria-label={`Open ${s.name}`} onClick={() => void bridge.openPath(s.localPath)}><ExternalLink size={15} /></button>}
                  <button className="icon-btn" title="Stop backing up" aria-label={`Stop backing up ${s.name}`} onClick={() => void remove(s)}><Trash2 size={15} /></button>
                </div>
              </div>
              <h3 title={s.name}>{s.name}</h3>
              <p className="folder-card__path" title={s.localPath}><bdi dir="ltr">{s.localPath}</bdi></p>
              <p className="folder-card__meta">{formatCount(s.filesSeen)} files · {formatBytes(s.bytesSeen)}</p>
              <div className="folder-card__status">
                {s.error ? (
                  <><CircleAlert size={14} /> <span>{s.available ? s.error : 'Not on this computer'}</span>
                    {!s.available && <button className="link-btn" onClick={() => void locate(s.id)}>Locate…</button>}</>
                ) : s.scanning ? (<><span className="pulse" /> Checking for changes…</>)
                  : s.pending > 0 ? (<><span className="pulse pulse--blue" /> {formatCount(s.pending)} to go</>)
                  : s.lastBackupAt ? (<><span className="ok-dot" /> Backed up {timeAgo(s.lastBackupAt)}</>)
                  : (<><span className="pulse pulse--blue" /> Waiting for the first backup</>)}
              </div>
            </article>
          ))}
          {!computer && (
            <button className="folder-card folder-card--add" onClick={() => void addFolders()}>
              <FolderPlus size={28} />
              <strong>Add folders</strong>
              <span>Choose one or more folders; everything inside is backed up automatically</span>
            </button>
          )}
        </div>
      </section>

      {snapshot.activity.length > 0 && (
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Recent activity</h2>
            <button className="link-btn" onClick={() => dispatch(viewChanged('activity'))}>See all</button>
          </div>
          <ActivityList items={snapshot.activity.slice(0, 5)} />
        </section>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__icon"><Icon size={18} /></span>
      <span><small>{label}</small><strong>{value}</strong></span>
    </div>
  );
}

const KIND: Record<ActivityItem['kind'], { icon: LucideIcon; label: string }> = {
  uploaded: { icon: ArrowUpFromLine, label: 'Backed up' },
  updated: { icon: RefreshCw, label: 'Updated' },
  skipped: { icon: SkipForward, label: 'Skipped' },
  failed: { icon: CircleAlert, label: 'Failed' },
};

function ActivityList({ items }: { items: ActivityItem[] }) {
  return (
    <ul className="activity">
      {items.map((a) => {
        const { icon: Icon, label } = KIND[a.kind];
        return (
          <li key={a.id} className={`activity__item activity__item--${a.kind}`}>
            <span className="activity__icon"><Icon size={15} /></span>
            <span className="activity__main">
              <strong title={a.relativePath}>{a.relativePath.split('/').pop()}</strong>
              <small title={a.message ?? a.relativePath}>{a.message ?? `${a.sourceName} / ${a.relativePath}`}</small>
            </span>
            <span className="activity__meta"><span>{label}</span><small>{formatBytes(a.sizeBytes)} · {timeAgo(a.at)}</small></span>
          </li>
        );
      })}
    </ul>
  );
}

function ActivityView({ items }: { items: ActivityItem[] }) {
  return (
    <div className="page">
      <div className="section-head section-head--page"><h1>Activity</h1><span className="muted">Files backed up since the app started</span></div>
      {items.length === 0 ? (
        <div className="empty"><Activity size={30} /><strong>Nothing yet</strong><span>Files appear here as they are backed up.</span></div>
      ) : <section className="panel"><ActivityList items={items} /></section>}
    </div>
  );
}

function SettingsView({ state }: { state: AppState }) {
  const dispatch = useAppDispatch();
  const device = state.device!;
  return (
    <div className="page">
      <div className="section-head section-head--page"><h1>Settings</h1></div>
      <section className="panel settings">
        <div className="setting">
          <span><strong>Start when I sign in to my computer</strong><small>Backup runs in the background; the app lives in the menu bar / system tray.</small></span>
          <label className="switch">
            <input type="checkbox" checked={state.settings.openAtLogin} onChange={(e) => void bridge.setOpenAtLogin(e.target.checked).then((s) => dispatch(stateReceived(s)))} />
            <span />
          </label>
        </div>
        <div className="setting">
          <span><strong>Pause backup</strong><small>Stop uploading until you resume.</small></span>
          <label className="switch">
            <input type="checkbox" checked={state.settings.paused} onChange={(e) => void bridge.setPaused(e.target.checked).then((s) => dispatch(stateReceived(s)))} />
            <span />
          </label>
        </div>
      </section>
      <section className="panel settings">
        <div className="setting">
          <span><strong>Device</strong><small>{device.name} · {device.driveLetter}: {device.driveName} › {device.folderPath.replace('/', ' › ')}</small></span>
          <button className="btn btn--ghost" onClick={() => void bridge.changeDevice().then((s) => dispatch(stateReceived(s)))}>Use a different device</button>
        </div>
        <div className="setting">
          <span><strong>Your files on the web</strong><small>Browse, share and restore backed-up files in HarDisk.</small></span>
          <button className="btn btn--ghost" onClick={() => void bridge.openWeb()}><ExternalLink size={15} /> Open HarDisk</button>
        </div>
        <div className="setting">
          <span><strong>Server</strong><small>{state.settings.apiBaseUrl}</small></span>
        </div>
      </section>
      <p className="muted small">Deleting a file on this computer never deletes it from the backup. Removing a folder stops backing it up; what was backed up stays in HarDisk.</p>
    </div>
  );
}
