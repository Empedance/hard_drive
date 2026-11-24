import { createHash } from 'node:crypto';
import { extname, relative, resolve, sep } from 'node:path';

/** Operating-system and editor scratch files that are never backed up. */
const IGNORED_NAMES = new Set(['pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'dumpstack.log.tmp', '.documentrevisions-v100', '.ds_store', 'thumbs.db', 'ehthumbs.db', 'desktop.ini', '.localized', 'icon\r', '$recycle.bin',
  'system volume information', '.trashes', '.trash', '.spotlight-v100', '.fseventsd', '.temporaryitems']);
const IGNORED_PREFIXES = ['~$', '._', '.~lock.'];
const IGNORED_SUFFIXES = ['.tmp', '.crdownload', '.part', '.partial', '.download', '.swp'];

export function isIgnored(name: string): boolean {
  const lower = name.toLowerCase();
  return IGNORED_NAMES.has(lower) || IGNORED_PREFIXES.some((p) => lower.startsWith(p)) || IGNORED_SUFFIXES.some((s) => lower.endsWith(s));
}

// Control characters are exactly what this pattern must catch.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[<>:"/\\|?*\x00-\x1F\x7F]/;

/** Why HarDisk would refuse this file or folder name (same rules as the server), or null when it is fine. */
export function nameProblem(name: string): string | null {
  if (name.length === 0 || name.length > 255) return 'Names must be 1 to 255 characters long.';
  if (FORBIDDEN.test(name)) return 'Names cannot contain < > : " / \\ | ? * or control characters.';
  if (name === '.' || name === '..' || name.endsWith('.')) return 'Names cannot end with a period.';
  if (name !== name.trim()) return 'Names cannot start or end with a space.';
  return null;
}

/** Path inside the backed-up folder with forward slashes, as the API expects ("Reports/2026/q1.xlsx"). */
export function relativePath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/');
}

/** Stable per file version, so a retried start of the same upload is recognised by the server. */
export function idempotencyKey(sourceId: number, rel: string, size: number, mtimeMs: number): string {
  return 'bk-' + createHash('sha256').update(`${sourceId}\n${rel}\n${size}\n${Math.round(mtimeMs)}`).digest('hex').slice(0, 40);
}

const TYPES: Record<string, string> = {
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
  '.html': 'text/html', '.xml': 'application/xml', '.rtf': 'application/rtf',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text', '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.heic': 'image/heic', '.heif': 'image/heif', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.zip': 'application/zip', '.7z': 'application/x-7z-compressed', '.rar': 'application/vnd.rar', '.gz': 'application/gzip', '.tar': 'application/x-tar',
};

export function contentTypeFor(name: string): string {
  return TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Operating-system areas skipped when a disk (or a home folder) is backed up: system files, installed apps, caches and
 * app data. Checked on absolute paths; nothing is skipped when the backed-up folder itself lies inside such an area, so a
 * folder the member picked on purpose is always backed up in full.
 */
const SYSTEM_AREAS: Record<string, RegExp[]> = {
  darwin: [
    /^\/(System|Library|private|usr|bin|sbin|opt|cores|dev|Volumes|Applications|var|etc|tmp|Network|net|home)(\/|$)/i,
    /^\/Users\/[^/]+\/(Library|\.Trash)(\/|$)/i,
  ],
  win32: [
    /^[A-Za-z]:\\(Windows|Program Files|Program Files \(x86\)|ProgramData|\$Recycle\.Bin|System Volume Information|Recovery|PerfLogs|Config\.Msi|\$WinREAgent|\$SysReset|\$Windows\.~BT|\$Windows\.~WS)(\\|$)/i,
    /^[A-Za-z]:\\Users\\[^\\]+\\AppData(\\|$)/i,
  ],
  linux: [
    /^\/(proc|sys|dev|run|tmp|var|usr|bin|sbin|lib|lib32|lib64|libx32|boot|etc|opt|snap|srv|lost\+found|mnt|media)(\/|$)/,
    /^\/home\/[^/]+\/\.cache(\/|$)/,
  ],
};

export function isSystemArea(absolute: string, platform: string = process.platform): boolean {
  return (SYSTEM_AREAS[platform] ?? []).some((re) => re.test(absolute));
}

/** True when `absolute` (inside the backed-up folder `root`) should be skipped as a system area. */
export function isExcludedPath(root: string, absolute: string, platform: string = process.platform): boolean {
  return absolute !== root && isSystemArea(absolute, platform) && !isSystemArea(root, platform);
}

/**
 * Where a local folder goes under the device folder: its full path, so parents and children line up.
 * "/Users/me/Desktop/test" → "Users/me/Desktop/test", "/" → "", "C:\\Users\\me" → "C/Users/me", "\\\\nas\\share\\x" → "nas/share/x".
 */
export function remotePathFor(localPath: string, platform: string = process.platform): string {
  if (platform === 'win32') {
    const abs = localPath.replace(/\//g, '\\');
    const drive = /^([A-Za-z]):/.exec(abs);
    const rest = (drive ? abs.slice(2) : abs).split('\\').filter(Boolean);
    return [...(drive ? [drive[1]!.toUpperCase()] : []), ...rest].join('/');
  }
  return resolve(localPath).split(sep).filter(Boolean).join('/');
}

