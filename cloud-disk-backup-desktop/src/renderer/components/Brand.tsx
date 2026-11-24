/** The HarDisk mark (same drawing as the web portal's AuthShell): two overlapping clouds. */
export function HarDiskMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.72} viewBox="0 0 64 46" role="img" aria-label="HarDisk" focusable="false">
      <defs>
        <linearGradient id="hdb-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3b82f6" /><stop offset="1" stopColor="#2563eb" /></linearGradient>
        <linearGradient id="hdb-b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset="1" stopColor="#22d3ee" /></linearGradient>
      </defs>
      <path d="M20 44C9 44 2 38 2 30c0-7 5-12 12-13 2-9 9-15 18-15 10 0 17 7 18 16-9-2-17 4-18 14-1 4-4 8-12 8z" fill="url(#hdb-a)" />
      <path d="M32 44c-7 0-11-4-11-10 0-7 5-11 11-11 1-7 7-11 13-11 8 0 14 6 14 13 4 1 6 5 6 9 0 6-5 10-11 10z" fill="url(#hdb-b)" opacity="0.95" />
    </svg>
  );
}

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand${small ? ' brand--small' : ''}`}>
      <HarDiskMark size={small ? 30 : 38} />
      <span>HarDisk <em>Backup</em></span>
    </div>
  );
}
