import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { safeStorage as SafeStorage } from 'electron';
import type { TokenStore } from './api';

/** The device this computer backs up as, for one signed-in member. */
export interface DeviceChoice { userId: number; deviceId: number; driveId: number; deviceKey: string }

export interface Config {
  apiBaseUrl: string;
  /** Random id created once on this computer; it names this computer's device folder. */
  computerKey: string;
  device: DeviceChoice | null;
  openAtLogin: boolean;
  paused: boolean;
  /** ffmpeg chosen by hand for CCTV recording; null finds it automatically. */
  ffmpegPath: string | null;
}

export const DEFAULT_API = process.env.HARDISK_API_URL ?? 'http://localhost:8080/api/v1';

/** Small JSON settings file in the app's data folder; written atomically. */
export class ConfigStore {
  private data: Config;

  constructor(private readonly path: string) {
    let stored: Partial<Config> = {};
    try { stored = JSON.parse(readFileSync(path, 'utf8')) as Partial<Config>; } catch { /* first start */ }
    this.data = {
      apiBaseUrl: stored.apiBaseUrl ?? DEFAULT_API,
      computerKey: stored.computerKey ?? randomUUID().replace(/-/g, ''),
      device: stored.device ?? null,
      openAtLogin: stored.openAtLogin ?? false,
      paused: stored.paused ?? false,
      ffmpegPath: stored.ffmpegPath ?? null,
    };
    if (!stored.computerKey) this.write();
  }

  get(): Config { return this.data; }

  update(patch: Partial<Config>): Config {
    this.data = { ...this.data, ...patch };
    this.write();
    return this.data;
  }

  private write(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path + '.tmp', JSON.stringify(this.data, null, 2));
    renameSync(this.path + '.tmp', this.path);
  }
}

/**
 * Keeps the refresh token encrypted with the operating system's keychain (Keychain, DPAPI, libsecret). Where no
 * keychain is available the token stays in memory only and the member signs in again after a restart.
 */
export class SecureTokenStore implements TokenStore {
  private memory: string | null = null;
  private loaded = false;
  private readonly path: string;

  constructor(dir: string, private readonly safe: typeof SafeStorage) { this.path = join(dir, 'session.bin'); }

  load(): string | null {
    if (!this.loaded) {
      this.loaded = true;
      try {
        if (this.safe.isEncryptionAvailable()) this.memory = this.safe.decryptString(readFileSync(this.path));
      } catch { this.memory = null; }
    }
    return this.memory;
  }

  save(token: string | null): void {
    this.memory = token;
    this.loaded = true;
    try {
      if (token == null) rmSync(this.path, { force: true });
      else if (this.safe.isEncryptionAvailable()) writeFileSync(this.path, this.safe.encryptString(token), { mode: 0o600 });
    } catch { /* keep it in memory */ }
  }
}
