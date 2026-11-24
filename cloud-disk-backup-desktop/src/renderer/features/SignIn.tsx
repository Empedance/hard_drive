import { useState, type FormEvent } from 'react';
import { ChevronDown, FileText, Folder, Image as ImageIcon, Lock, Music, RefreshCw, ShieldCheck } from 'lucide-react';
import type { AppState } from '../../shared/types';
import { bridge } from '../app/bridge';
import { stateReceived, useAppDispatch } from '../app/store';
import { Brand, HarDiskMark } from '../components/Brand';

export function SignIn({ state }: { state: AppState }) {
  const dispatch = useAppDispatch();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(state.settings.apiBaseUrl);
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await bridge.signIn(email, password, server);
    setBusy(false);
    if (result.ok) dispatch(stateReceived(result.value));
    else setError(result.error.status === 401 ? 'Wrong email or password.' : [result.error.message, result.error.description].filter(Boolean).join(' — '));
  }

  return (
    <main className="signin">
      <section className="signin__hero drag">
        <div className="signin__brand"><Brand /></div>
        <div className="signin__art" aria-hidden="true">
          <span className="signin__ring signin__ring--1" />
          <span className="signin__ring signin__ring--2" />
          <span className="signin__tile signin__tile--a"><FileText size={22} /></span>
          <span className="signin__tile signin__tile--b"><ImageIcon size={22} /></span>
          <span className="signin__tile signin__tile--c"><Folder size={22} /></span>
          <span className="signin__tile signin__tile--d"><Music size={22} /></span>
          <div className="signin__cloud"><HarDiskMark size={132} /></div>
        </div>
        <div className="signin__copy">
          <p className="eyebrow">Automatic backup</p>
          <h1>Your folders,<br />safe in <em>HarDisk</em>.</h1>
          <ul className="signin__points">
            <li><RefreshCw size={16} /> New and changed files upload on their own</li>
            <li><Folder size={16} /> Same folder structure as on your computer</li>
            <li><Lock size={16} /> Stored in your organization’s drive</li>
          </ul>
        </div>
      </section>

      <section className="signin__panel">
        <form className="signin__form" onSubmit={submit}>
          <h2>Sign in</h2>
          <p className="muted">Use your HarDisk organization account.</p>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="button" className="link-btn" aria-expanded={showServer} onClick={() => setShowServer((v) => !v)}>
            Server <ChevronDown size={14} className={showServer ? 'rot' : ''} />
          </button>
          {showServer && (
            <label className="field">
              <span>API address</span>
              <input type="url" required value={server} onChange={(e) => setServer(e.target.value)} />
            </label>
          )}
          {error && <p className="alert" role="alert">{error}</p>}
          <button className="btn btn--primary btn--block" disabled={busy}>{busy ? <span className="spinner spinner--light" /> : 'Sign in'}</button>
          <p className="signin__secure"><ShieldCheck size={15} /> Your password is sent only to your HarDisk server.</p>
        </form>
      </section>
    </main>
  );
}
