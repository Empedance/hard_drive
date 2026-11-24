import type { HarDiskBridge } from '../../shared/types';
import { createMockBridge } from './mockBridge';

declare global {
  interface Window { hardisk?: HarDiskBridge }
}

/**
 * The main-process API from the preload script. Opened in a plain browser during development (no Electron), the window
 * uses an in-memory stand-in so the screens can be designed and checked without a backend; production builds never
 * include it.
 */
export const isMock = !window.hardisk;
export const bridge: HarDiskBridge = window.hardisk ?? (import.meta.env.DEV ? createMockBridge() : missing());

function missing(): never { throw new Error('HarDisk Backup must run inside its desktop app.'); }
