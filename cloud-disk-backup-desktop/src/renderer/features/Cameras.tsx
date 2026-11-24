import { useEffect, useState } from 'react';
import {
  Camera, Cctv, ChevronRight, CircleAlert, CloudUpload, Gauge, HardDrive, Image as ImageIcon, Pencil, Plus, Radio, Timer, Trash2, Video, X, type LucideIcon,
} from 'lucide-react';
import type { AppState, CameraLive, CameraSettings, DriveOption, NewRecorder, RecorderBrand, RecorderConnection, RecorderInfo, Result } from '../../shared/types';
import { bridge } from '../app/bridge';
import { stateReceived, useAppDispatch, useAppSelector } from '../app/store';
import { formatBytes, formatCount, timeAgo } from '../app/format';

const BRANDS: { id: RecorderBrand; label: string }[] = [
  { id: 'hikvision', label: 'Hikvision · HiLook · Prama' },
  { id: 'dahua', label: 'Dahua · CP Plus · Amcrest · Lorex' },
  { id: 'uniview', label: 'Uniview (UNV)' },
  { id: 'custom', label: 'Other brand (RTSP address)' },
];
const KEEP = [0, 7, 15, 30, 60, 90, 180, 365];
const keepLabel = (d: number) => (d === 0 ? 'Keep forever' : `Keep ${d} days`);
const brandLabel = (b: RecorderBrand) => BRANDS.find((x) => x.id === b)?.label.split(' · ')[0] ?? b;
const message = (r: Result<unknown>) => (r.ok ? null : [r.error.message, r.error.description].filter(Boolean).join(' — '));

function formatBitrate(bps: number): string {
  if (bps <= 0) return '—';
  return bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} Mbit/s` : `${Math.round(bps / 1e3)} kbit/s`;
}

/** Seconds the cloud copy is behind live. */
function behind(live: CameraLive | undefined, now: number): number | null {
  if (!live?.cloudUpTo) return null;
  return Math.max(0, Math.round((now - new Date(live.cloudUpTo).getTime()) / 1000));
}

function formatGap(s: number | null): string {
  if (s == null) return '—';
  if (s < 90) return `${s} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}

/** CCTV: recorders on the local network whose cameras are recorded to the cloud in short clips. */
export function Cameras({ state }: { state: AppState }) {
  const cctv = useAppSelector((s) => s.cctv);
  const [now, setNow] = useState(() => Date.now());
  const [editing, setEditing] = useState<RecorderInfo | 'new' | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const liveById = new Map(cctv.cameras.map((c) => [c.id, c]));
  const active = cctv.cameras.filter((c) => c.state !== 'stopped');
  const recording = cctv.cameras.filter((c) => c.state === 'recording');
  const gaps = recording.map((c) => behind(c, now)).filter((g): g is number => g != null);
  const upload = recording.reduce((a, c) => a + c.bitrate, 0);

  return (
    <div className="page">
      <div className="section-head section-head--page">
        <h1>Cameras</h1>
        <span className="muted">Live CCTV recording to HarDisk in 10-second clips</span>
        <button className="btn btn--primary push-right" onClick={() => setEditing('new')}><Plus size={16} /> Add recorder</button>
      </div>

      {!cctv.ffmpegPath && <FfmpegMissing platform={state.platform} />}

      {state.recorders.length === 0 ? (
        <section className="cctv-empty">
          <span className="cctv-empty__icon"><Cctv size={30} /></span>
          <h2>Keep a copy of your CCTV in the cloud</h2>
          <p>Connect this computer to your NVR or DVR on the same network. Every camera is recorded to HarDisk as it happens,
            so if the recorder is stolen, damaged or switched off, the recordings up to the last few seconds are safe.</p>
          <ul className="cctv-empty__points">
            <li><Timer size={15} /> About 10–20 seconds behind live</li>
            <li><Video size={15} /> Original quality, no re-encoding</li>
            <li><CloudUpload size={15} /> Keeps clips while offline and catches up</li>
          </ul>
          <button className="btn btn--primary" onClick={() => setEditing('new')}><Plus size={16} /> Add recorder</button>
        </section>
      ) : (
        <>
          <section className="stats">
            <Stat icon={Radio} label="Recording" value={`${recording.length} of ${active.length} cameras`} />
            <Stat icon={Timer} label="Cloud behind live" value={gaps.length ? `${formatGap(Math.max(...gaps))} at most` : '—'} />
            <Stat icon={Gauge} label="Upload needed" value={formatBitrate(upload)} />
            <Stat icon={HardDrive} label="Waiting on this computer" value={formatBytes(cctv.spoolBytes)} />
          </section>
          {state.recorders.map((r) => <RecorderPanel key={r.id} recorder={r} live={liveById} now={now} onEdit={() => setEditing(r)} />)}
          {cctv.activity.length > 0 && (
            <section className="panel">
              <h2 className="panel__title">Recent clips</h2>
              <ul className="activity">
                {cctv.activity.slice(0, 8).map((a) => (
                  <li key={a.id} className={`activity__item activity__item--${a.kind === 'uploaded' ? 'uploaded' : a.kind === 'failed' ? 'failed' : 'skipped'}`}>
                    <span className="activity__icon">{a.kind === 'failed' ? <CircleAlert size={15} /> : a.kind === 'info' ? <Radio size={15} /> : <CloudUpload size={15} />}</span>
                    <span className="activity__main"><strong>{a.cameraName}</strong><small title={a.message}>{a.message}</small></span>
                    <span className="activity__meta"><span>{a.kind === 'uploaded' ? 'In the cloud' : a.kind === 'failed' ? 'Problem' : 'Camera'}</span>
                      <small>{a.sizeBytes ? `${formatBytes(a.sizeBytes)} · ` : ''}{timeAgo(a.at)}</small></span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <p className="muted small">Camera passwords stay on this computer, encrypted. Keep this computer on, and away from the recorder if you can, so one theft cannot take both.
        Recordings are in your drive under CCTV, by camera, day and hour.</p>
      {editing && <RecorderForm state={state} recorder={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function FfmpegMissing({ platform }: { platform: string }) {
  const dispatch = useAppDispatch();
  const install = platform === 'darwin' ? 'brew install ffmpeg' : platform === 'win32' ? 'winget install ffmpeg' : 'sudo apt install ffmpeg';
  return (
    <p className="alert alert--block">
      <CircleAlert size={16} />
      <span><strong>ffmpeg is needed to record cameras.</strong> It reads the camera streams. Install it (for example <code>{install}</code>), then restart
        the app, or choose where it is.</span>
      <button className="btn btn--ghost" onClick={() => void bridge.cctvChooseFfmpeg().then(() => bridge.getState()).then((s) => dispatch(stateReceived(s)))}>Choose ffmpeg…</button>
    </p>
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

function RecorderPanel({ recorder: r, live, now, onEdit }: { recorder: RecorderInfo; live: Map<number, CameraLive>; now: number; onEdit: () => void }) {
  const dispatch = useAppDispatch();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const free = Array.from({ length: 64 }, (_, i) => i + 1).find((ch) => !r.cameras.some((c) => c.channel === ch)) ?? 1;
  const [channel, setChannel] = useState(free);
  const [name, setName] = useState('');

  async function run(work: Promise<Result<AppState>>) {
    setError(null);
    const result = await work;
    if (result.ok) dispatch(stateReceived(result.value));
    else setError(message(result));
    return result.ok;
  }
  async function remove() {
    if (window.confirm(`Stop recording “${r.name}”?\n\nIts cameras stop uploading. Recordings already in HarDisk stay in the drive.`)) await run(bridge.cctvRemoveRecorder(r.id));
  }
  async function keep(days: number) {
    if (days > 0 && (r.retentionDays === 0 || days < r.retentionDays)
      && !window.confirm(`Delete recordings older than ${days} days?\n\nOlder days are deleted permanently from HarDisk (not to the trash), now and every day from now on.`)) return;
    await run(bridge.cctvUpdateRecorder(r.id, { retentionDays: days }));
  }
  async function addCamera() {
    if (await run(bridge.cctvAddCamera(r.id, channel, name.trim() || `Camera ${channel}`))) { setAdding(false); setName(''); }
  }

  return (
    <section className="panel recorder">
      <div className="recorder__head">
        <span className="recorder__icon"><Cctv size={20} /></span>
        <div className="recorder__title">
          <h2 title={r.name}>{r.name}</h2>
          <small>{brandLabel(r.brand)} · {r.brand === 'custom' ? 'RTSP address' : r.host} · {r.stream === 'main' ? 'Main stream' : 'Sub stream'}</small>
          <small className="recorder__path"><HardDrive size={12} /> {r.driveLetter}: {r.driveName} <ChevronRight size={11} /> {r.folderPath.replace('/', ' › ')}</small>
        </div>
        <div className="recorder__actions">
          <select className="select" value={r.retentionDays} aria-label="How long recordings are kept" onChange={(e) => void keep(Number(e.target.value))}>
            {[...new Set([...KEEP, r.retentionDays])].sort((a, b) => a - b).map((d) => (
              <option key={d} value={d} disabled={!r.canSetRetention && d !== 0 && (r.retentionDays === 0 || d < r.retentionDays)}>{keepLabel(d)}</option>
            ))}
          </select>
          <button className="icon-btn" title="Edit connection" aria-label={`Edit ${r.name}`} onClick={onEdit}><Pencil size={15} /></button>
          <button className="icon-btn" title="Stop recording this recorder" aria-label={`Remove ${r.name}`} onClick={() => void remove()}><Trash2 size={15} /></button>
        </div>
      </div>
      {!r.canSetRetention && r.retentionDays === 0 && <p className="muted small recorder__hint">Recordings are kept until you delete them. Ask a drive manager to delete old recordings automatically.</p>}
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="camera-grid">
        {r.cameras.map((c) => <CameraTile key={c.id} camera={c} live={live.get(c.id)} now={now} onError={setError} />)}
        {adding ? (
          <div className="camera-tile camera-tile--form">
            <label className="field"><span>Channel</span>
              <input type="number" min={1} max={64} value={channel} onChange={(e) => setChannel(Number(e.target.value))} /></label>
            <label className="field"><span>Name</span>
              <input value={name} placeholder={`Camera ${channel}`} maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
            <div className="row-actions">
              <button className="btn btn--ghost" onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={() => void addCamera()}>Add</button>
            </div>
          </div>
        ) : (
          <button className="camera-tile camera-tile--add" onClick={() => { setChannel(free); setAdding(true); }}>
            <Plus size={24} /><strong>Add camera</strong><span>Another channel of this recorder</span>
          </button>
        )}
      </div>
    </section>
  );
}

function CameraTile({ camera: c, live, now, onError }: { camera: CameraSettings; live: CameraLive | undefined; now: number; onError: (m: string | null) => void }) {
  const dispatch = useAppDispatch();
  const [picture, setPicture] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(c.name);
  const state = !c.enabled ? 'stopped' : live?.state ?? 'starting';
  const gap = behind(live, now);

  async function show() {
    setLoading(true);
    const r = await bridge.cctvPreview(c.id);
    setLoading(false);
    if (r.ok) { setPicture(r.value); onError(null); } else onError(message(r));
  }
  async function update(patch: { name?: string; enabled?: boolean }) {
    const r = await bridge.cctvUpdateCamera(c.id, patch);
    if (r.ok) dispatch(stateReceived(r.value)); else onError(message(r));
  }
  async function remove() {
    if (!window.confirm(`Stop recording “${c.name}”?\n\nRecordings already in HarDisk stay in the drive.`)) return;
    const r = await bridge.cctvRemoveCamera(c.id);
    if (r.ok) dispatch(stateReceived(r.value)); else onError(message(r));
  }

  const status = state === 'stopped' ? 'Not recording'
    : state === 'recording' ? (gap == null ? 'Recording · first clip on its way' : `Recording · cloud ${formatGap(gap)} behind`)
    : state === 'starting' ? 'Connecting…'
    : live?.message ?? (state === 'reconnecting' ? 'Reconnecting…' : 'Needs attention');

  return (
    <article className={`camera-tile camera-tile--${state}`}>
      <div className="camera-tile__view">
        {picture ? <img src={picture} alt={`Picture from ${c.name}`} /> : <Camera size={28} />}
        {state === 'recording' && <span className="rec-badge"><span /> REC</span>}
        <button className="camera-tile__peek" onClick={() => void show()} disabled={loading}>
          {loading ? <span className="spinner" /> : <><ImageIcon size={13} /> {picture ? 'Refresh' : 'Show picture'}</>}
        </button>
      </div>
      <div className="camera-tile__body">
        {renaming ? (
          <form className="camera-tile__rename" onSubmit={(e) => { e.preventDefault(); setRenaming(false); if (name.trim() && name.trim() !== c.name) void update({ name: name.trim() }); }}>
            <input className="inline-input" autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} onBlur={(e) => e.currentTarget.form?.requestSubmit()} aria-label="Camera name" />
          </form>
        ) : (
          <h3 title={c.name}>{c.name}<button className="icon-btn" aria-label={`Rename ${c.name}`} title="Rename" onClick={() => { setName(c.name); setRenaming(true); }}><Pencil size={13} /></button></h3>
        )}
        <p className="camera-tile__meta">Channel {c.channel}{live && live.uploadedClips > 0 ? ` · ${formatCount(live.uploadedClips)} clips · ${formatBitrate(live.bitrate)}` : ''}
          {live && live.queuedClips > 1 ? ` · ${live.queuedClips} waiting` : ''}</p>
        <p className="camera-tile__status" title={status}>
          {state === 'recording' ? <span className="ok-dot" /> : state === 'stopped' ? <span className="pulse" /> : state === 'starting' ? <span className="pulse pulse--blue" /> : <CircleAlert size={13} />}
          <span>{status}</span>
        </p>
        <div className="camera-tile__foot">
          <label className="switch switch--small" title={c.enabled ? 'Stop recording' : 'Start recording'}>
            <input type="checkbox" checked={c.enabled} onChange={(e) => void update({ enabled: e.target.checked })} aria-label={`Record ${c.name}`} />
            <span />
          </label>
          <span className="muted small">{c.enabled ? 'Recording on' : 'Recording off'}</span>
          <button className="icon-btn push-right" aria-label={`Remove ${c.name}`} title="Remove camera" onClick={() => void remove()}><Trash2 size={14} /></button>
        </div>
      </div>
    </article>
  );
}

function RecorderForm({ state, recorder, onClose }: { state: AppState; recorder: RecorderInfo | null; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const [drives, setDrives] = useState<DriveOption[]>([]);
  const [name, setName] = useState(recorder?.name ?? 'Shop NVR');
  const [brand, setBrand] = useState<RecorderBrand>(recorder?.brand ?? 'hikvision');
  const [host, setHost] = useState(recorder?.host ?? '');
  const [port, setPort] = useState(recorder?.port ?? 554);
  const [username, setUsername] = useState(recorder?.username ?? 'admin');
  const [password, setPassword] = useState('');
  const [stream, setStream] = useState<'main' | 'sub'>(recorder?.stream ?? 'main');
  const [template, setTemplate] = useState(recorder?.urlTemplate ?? 'rtsp://192.168.1.64:554/live/ch{channel}');
  const [channels, setChannels] = useState(4);
  const [driveId, setDriveId] = useState<number | null>(recorder?.driveId ?? state.device?.driveId ?? null);
  const [keepDays, setKeepDays] = useState(0);
  const [picture, setPicture] = useState<string | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void bridge.listDrives().then((r) => { if (r.ok) setDrives(r.value); }); }, []);
  const drive = drives.find((d) => d.id === driveId);
  const canKeep = drive?.myPermission === 'MANAGER';
  const connection = (): RecorderConnection => ({ brand, host, port, username, password: password || undefined, stream, urlTemplate: brand === 'custom' ? template : null });

  async function test() {
    setBusy('test'); setError(null); setPicture(null);
    const r = await bridge.cctvTest(connection(), recorder?.cameras[0]?.channel ?? 1, recorder?.id);
    setBusy(null);
    if (r.ok) setPicture(r.value); else setError(message(r));
  }
  async function save() {
    setBusy('save'); setError(null);
    let r: Result<AppState>;
    if (recorder) {
      r = await bridge.cctvUpdateRecorder(recorder.id, { name: name.trim() !== recorder.name ? name.trim() : undefined, connection: connection() });
    } else {
      if (!driveId) { setBusy(null); setError('Choose the drive to record to.'); return; }
      const input: NewRecorder = { ...connection(), name: name.trim(), driveId, retentionDays: canKeep ? keepDays : 0,
        cameras: Array.from({ length: Math.max(1, Math.min(64, channels)) }, (_, i) => ({ channel: i + 1, name: `Camera ${i + 1}` })) };
      r = await bridge.cctvAddRecorder(input);
    }
    setBusy(null);
    if (r.ok) { dispatch(stateReceived(r.value)); onClose(); } else setError(message(r));
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={recorder ? `Edit ${recorder.name}` : 'Add recorder'} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="modal__card">
        <div className="modal__head">
          <h2>{recorder ? 'Edit recorder' : 'Add a recorder'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <p className="muted small">This computer must be on the same network as the NVR/DVR. Use the recorder’s IP address and its admin user (as in the recorder’s menu or mobile app).</p>
        <div className="form-grid">
          <label className="field field--wide"><span>Name</span><input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field field--wide"><span>Brand</span>
            <select className="select" value={brand} onChange={(e) => setBrand(e.target.value as RecorderBrand)}>
              {BRANDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select></label>
          {brand === 'custom' ? (
            <label className="field field--wide"><span>Stream address <small className="muted">({'{channel}'} becomes the channel number)</small></span>
              <input value={template} spellCheck={false} onChange={(e) => setTemplate(e.target.value)} /></label>
          ) : (
            <>
              <label className="field"><span>IP address</span><input value={host} placeholder="192.168.1.64" spellCheck={false} onChange={(e) => setHost(e.target.value)} /></label>
              <label className="field field--narrow"><span>RTSP port</span><input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} /></label>
            </>
          )}
          <label className="field"><span>User name</span><input value={username} spellCheck={false} autoComplete="off" onChange={(e) => setUsername(e.target.value)} /></label>
          <label className="field"><span>Password</span><input type="password" value={password} autoComplete="new-password"
            placeholder={recorder?.hasPassword ? 'Unchanged' : ''} onChange={(e) => setPassword(e.target.value)} /></label>
          <div className="field field--wide"><span>Quality</span>
            <div className="segmented" role="radiogroup" aria-label="Stream">
              <button role="radio" aria-checked={stream === 'main'} onClick={() => setStream('main')}>Main stream · full quality</button>
              <button role="radio" aria-checked={stream === 'sub'} onClick={() => setStream('sub')}>Sub stream · less upload</button>
            </div>
          </div>
          {!recorder && (
            <>
              <label className="field field--narrow"><span>Cameras</span><input type="number" min={1} max={64} value={channels} onChange={(e) => setChannels(Number(e.target.value))} /></label>
              <label className="field field--grow"><span>Record to</span>
                <select className="select" value={driveId ?? ''} onChange={(e) => setDriveId(Number(e.target.value))}>
                  {drives.map((d) => <option key={d.id} value={d.id}>{d.letter}: {d.name} ({formatBytes(d.freeBytes)} free)</option>)}
                </select></label>
              <label className="field field--wide"><span>Old recordings</span>
                <select className="select" value={canKeep ? keepDays : 0} disabled={!canKeep} onChange={(e) => setKeepDays(Number(e.target.value))}>
                  {KEEP.map((d) => <option key={d} value={d}>{d === 0 ? 'Keep forever' : `Delete after ${d} days`}</option>)}
                </select></label>
            </>
          )}
        </div>
        {!recorder && <p className="muted small">Channels 1 to {Math.max(1, Math.min(64, channels))} are added; rename or switch off cameras afterwards. Each camera needs about 1–4 Mbit/s of upload on the main stream.</p>}
        {picture && <img className="test-picture" src={picture} alt="Picture from channel 1" />}
        {error && <p className="alert" role="alert">{error}</p>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={() => void test()} disabled={busy != null}>{busy === 'test' ? <span className="spinner" /> : <><Camera size={15} /> Test connection</>}</button>
          <span className="push-right" />
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={() => void save()} disabled={busy != null || !name.trim() || (brand !== 'custom' && !host.trim())}>
            {busy === 'save' ? <span className="spinner spinner--light" /> : recorder ? 'Save' : 'Start recording'}
          </button>
        </div>
      </div>
    </div>
  );
}
