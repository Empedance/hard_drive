import type { RecorderBrand, RecorderConnection, StreamQuality } from '../../shared/types';

/**
 * RTSP paths of the common NVR/DVR families. Most recorders sold under other names use one of these (Hikvision: HiLook,
 * Prama, many OEM boxes; Dahua: CP Plus, Amcrest, Lorex). Anything else uses a custom address.
 */
const PATHS: Record<Exclude<RecorderBrand, 'custom'>, (channel: number, stream: StreamQuality) => string> = {
  hikvision: (ch, s) => `/Streaming/Channels/${ch}0${s === 'main' ? 1 : 2}`,
  dahua: (ch, s) => `/cam/realmonitor?channel=${ch}&subtype=${s === 'main' ? 0 : 1}`,
  uniview: (ch, s) => `/unicast/c${ch}/s${s === 'main' ? 0 : 1}/live`,
};

export const BRANDS: { id: RecorderBrand; label: string }[] = [
  { id: 'hikvision', label: 'Hikvision, HiLook, Prama' },
  { id: 'dahua', label: 'Dahua, CP Plus, Amcrest, Lorex' },
  { id: 'uniview', label: 'Uniview (UNV)' },
  { id: 'custom', label: 'Other (RTSP address)' },
];

/** The stream address of one channel, with the user and password in it (never shown or logged; see redact()). */
export function streamUrl(c: RecorderConnection, channel: number, password: string): string {
  const auth = c.username ? `${encodeURIComponent(c.username)}:${encodeURIComponent(password)}@` : '';
  if (c.brand === 'custom') {
    const template = (c.urlTemplate ?? '').trim();
    if (!/^(rtsps?|https?|rtmp):\/\//i.test(template)) throw new Error('Enter the full stream address, starting with rtsp://');
    const filled = template.replace(/\{channel\}/gi, String(channel));
    // Put the user and password in, unless the address already has them.
    return /^[a-z]+:\/\/[^/]*@/i.test(filled) || !auth ? filled : filled.replace(/^([a-z]+:\/\/)/i, `$1${auth}`);
  }
  const host = c.host.trim();
  if (!/^[A-Za-z0-9.\-:[\]]+$/.test(host)) throw new Error('Enter the recorder’s IP address or host name, like 192.168.1.64');
  const port = Number.isInteger(c.port) && c.port > 0 && c.port < 65536 ? c.port : 554;
  return `rtsp://${auth}${host}:${port}${PATHS[c.brand](channel, c.stream)}`;
}

/** The address without user and password, for messages. */
export function redact(text: string): string {
  return text.replace(/([a-z]+:\/\/)[^/@\s]*@/gi, '$1***@');
}
