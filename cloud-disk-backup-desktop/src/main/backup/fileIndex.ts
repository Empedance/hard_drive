import { mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/** What was last backed up of one file: [size, modification time in ms]. */
export type Entry = [number, number];

/**
 * Per-folder memory of backed-up files, so a restart only uploads what changed. Losing it is harmless: the server
 * answers UNCHANGED for files it already has, so the next pass only costs requests.
 */
export class FileIndex {
  private files = new Map<string, Entry>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly path: string | null) {
    if (!path) return;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { files?: Record<string, Entry> };
      this.files = new Map(Object.entries(parsed.files ?? {}));
    } catch { /* first run */ }
  }

  static forSource(dir: string | null, sourceId: number): FileIndex {
    if (!dir) return new FileIndex(null);
    mkdirSync(dir, { recursive: true });
    return new FileIndex(join(dir, `source-${sourceId}.json`));
  }

  matches(rel: string, size: number, mtimeMs: number): boolean {
    const e = this.files.get(rel);
    return e != null && e[0] === size && Math.abs(e[1] - mtimeMs) < 1;
  }

  set(rel: string, size: number, mtimeMs: number): void {
    this.files.set(rel, [size, mtimeMs]);
    this.scheduleSave();
  }

  get size(): number { return this.files.size; }

  /**
   * Takes over what another folder's index knows, under `prefix` ("test" → "test/a.txt"): used when a parent folder
   * replaces a folder that was backed up on its own, so its unchanged files are not even announced again.
   */
  absorb(other: FileIndex, prefix: string): void {
    const base = prefix.replace(/^\/+|\/+$/g, '');
    for (const [rel, entry] of other.files) this.files.set(base ? `${base}/${rel}` : rel, entry);
    this.flush();
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.path) return;
    const tmp = this.path + '.tmp';
    writeFileSync(tmp, JSON.stringify({ v: 1, files: Object.fromEntries(this.files) }));
    renameSync(tmp, this.path);
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.path) rmSync(this.path, { force: true });
  }

  private scheduleSave(): void {
    if (this.timer || !this.path) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 2000);
    this.timer.unref?.();
  }
}
