import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Clip length. With the time to upload a clip, the cloud copy stays about 10–20 seconds behind live. */
export const CLIP_SECONDS = 10;

/** Clip files are named by their local start time: 2026-11-18_14-05-30.mp4 */
const CLIP_NAME = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.mp4$/;

/** Where ffmpeg may be when it is not configured: next to the app (packaged builds), then the usual install places. */
export function ffmpegCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, resourcesPath?: string): string[] {
  const exe = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const list: string[] = [];
  if (env.HARDISK_FFMPEG) list.push(env.HARDISK_FFMPEG);
  if (resourcesPath) list.push(join(resourcesPath, exe));
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) list.push(join(dir, exe));
  if (platform === 'darwin') list.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg');
  else if (platform === 'win32') list.push('C:\\ffmpeg\\bin\\ffmpeg.exe', join(env.ProgramFiles ?? 'C:\\Program Files', 'ffmpeg', 'bin', 'ffmpeg.exe'));
  else list.push('/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/snap/bin/ffmpeg');
  return [...new Set(list)];
}

export function firstExecutable(paths: string[]): string | null {
  for (const p of paths) {
    try { accessSync(p, constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

/** Checks that the file really is ffmpeg (prints its version). */
export function verifyFfmpeg(path: string): Promise<boolean> {
  return new Promise((done) => execFile(path, ['-hide_banner', '-version'], { timeout: 10_000 }, (err, out) => done(!err && /ffmpeg version/i.test(String(out)))));
}

const isRtsp = (url: string) => /^rtsps?:\/\//i.test(url);

/** Options for reading a camera stream: TCP for RTSP (no lost packets on busy networks) and a read timeout. */
function inputArgs(url: string): string[] {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (isRtsp(url)) args.push('-rtsp_transport', 'tcp');
  if (isRtsp(url) || /^https?:\/\//i.test(url)) args.push('-timeout', '15000000'); // µs: give up on a silent stream after 15 s
  return [...args, '-i', url];
}

/**
 * Records a stream into CLIP_SECONDS clips without re-encoding the video (low CPU, original quality). Clips start on the
 * clock (…:00, :10, :20) and are fragmented MP4, so even a clip cut short by a power cut or theft plays up to its last
 * second. Audio, when the camera has it, becomes AAC because most NVR audio (G.711) cannot go into MP4.
 */
export function recordArgs(url: string, dir: string, clipSeconds = CLIP_SECONDS): string[] {
  return [
    ...inputArgs(url),
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k',
    '-f', 'segment', '-segment_time', String(clipSeconds), '-segment_atclocktime', '1', '-reset_timestamps', '1',
    '-segment_format', 'mp4', '-segment_format_options', 'movflags=+frag_keyframe+empty_moov+default_base_moof',
    '-strftime', '1', join(dir, '%Y-%m-%d_%H-%M-%S.mp4'),
  ];
}

/** One JPEG frame on stdout. */
export function snapshotArgs(url: string): string[] {
  return [...inputArgs(url), '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '5', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'];
}

export function isClipName(name: string): boolean { return CLIP_NAME.test(name); }

/** When the clip started, from its name (local time of this computer). */
export function clipStart(name: string): Date | null {
  const m = CLIP_NAME.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  return new Date(y, mo - 1, d, h, mi, s);
}

/** The last useful line ffmpeg printed, worded for people. */
export function explainFfmpegError(stderr: string): string {
  const text = stderr.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
  if (/401|unauthorized/i.test(stderr)) return 'The recorder refused the user name or password.';
  if (/404|not found/i.test(stderr)) return 'The recorder has no such channel or stream. Check the channel number and brand.';
  if (/connection refused/i.test(stderr)) return 'The recorder refused the connection. Check the IP address and RTSP port (usually 554).';
  if (/timed out|timeout|no route|unreachable|host is down/i.test(stderr)) return 'The recorder is not reachable on the network.';
  if (/invalid data|could not find codec/i.test(stderr)) return 'The stream could not be read. Try the other stream (main/sub) or check the address.';
  return text ? text.slice(0, 200) : 'The recorder stopped sending video.';
}
