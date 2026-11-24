import { Check, CloudOff, Pause, TriangleAlert } from 'lucide-react';
import type { EngineStatus } from '../../shared/types';

/** The big status ring on the overview: a progress arc while uploading, a calm check when everything is backed up. */
export function StatusOrb({ status, progress }: { status: EngineStatus; progress: number }) {
  const r = 52, c = 2 * Math.PI * r;
  const busy = status === 'uploading' || status === 'scanning';
  return (
    <div className={`orb orb--${status}`} aria-hidden="true">
      <svg viewBox="0 0 128 128" className={busy ? 'orb__ring orb__ring--spin' : 'orb__ring'}>
        <defs>
          <linearGradient id="orb-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset="1" stopColor="#2563eb" /></linearGradient>
        </defs>
        <circle cx="64" cy="64" r={r} className="orb__track" />
        <circle cx="64" cy="64" r={r} className="orb__arc" strokeDasharray={c}
          strokeDashoffset={status === 'uploading' ? c * (1 - Math.max(0.06, progress)) : status === 'scanning' ? c * 0.75 : 0} />
      </svg>
      <span className="orb__icon">
        {status === 'paused' ? <Pause size={34} /> : status === 'offline' ? <CloudOff size={34} /> : status === 'error' ? <TriangleAlert size={34} />
          : busy ? <span className="orb__pct">{status === 'scanning' ? '…' : `${Math.round(progress * 100)}%`}</span> : <Check size={40} strokeWidth={2.6} />}
      </span>
    </div>
  );
}
