import { describe, expect, it } from 'vitest';
import { idempotencyKey, remotePathFor, isExcludedPath, isIgnored, nameProblem, relativePath } from './rules';
import { join } from 'node:path';

describe('rules', () => {
  it('ignores OS and editor scratch files only', () => {
    for (const n of ['.DS_Store', 'Thumbs.db', 'desktop.ini', '~$Report.docx', '._photo.jpg', 'video.mp4.crdownload', 'x.tmp']) expect(isIgnored(n)).toBe(true);
    for (const n of ['Report.docx', '.env.example', 'photo.jpg', 'tmp']) expect(isIgnored(n)).toBe(false);
  });
  it('applies the server’s name rules', () => {
    expect(nameProblem('ok name.txt')).toBeNull();
    expect(nameProblem('a:b')).not.toBeNull();
    expect(nameProblem('trailing.')).not.toBeNull();
    expect(nameProblem(' padded')).not.toBeNull();
  });
  it('builds forward-slash relative paths and stable idempotency keys', () => {
    expect(relativePath(join('/r'), join('/r', 'a', 'b.txt'))).toBe('a/b.txt');
    expect(idempotencyKey(1, 'a', 2, 3)).toBe(idempotencyKey(1, 'a', 2, 3.2));
    expect(idempotencyKey(1, 'a', 2, 3)).not.toBe(idempotencyKey(1, 'a', 3, 3));
    expect(idempotencyKey(1, 'a', 2, 3).length).toBeLessThanOrEqual(100);
  });

  it('skips system areas when a whole disk is backed up, but never inside a folder picked on purpose', () => {
    expect(isExcludedPath('/', '/System/Library', 'darwin')).toBe(true);
    expect(isExcludedPath('/', '/Applications/Safari.app', 'darwin')).toBe(true);
    expect(isExcludedPath('/', '/Users/niyam/Library/Caches', 'darwin')).toBe(true);
    expect(isExcludedPath('/', '/Users/niyam/Documents/a.pdf', 'darwin')).toBe(false);
    expect(isExcludedPath('/Users/niyam', '/Users/niyam/Library', 'darwin')).toBe(true);
    expect(isExcludedPath('/Users/niyam/Projects', '/Users/niyam/Projects/Library', 'darwin')).toBe(false);
    expect(isExcludedPath('/Volumes/USB', '/Volumes/USB/Photos', 'darwin')).toBe(false);
    expect(isExcludedPath('/Library/Fonts', '/Library/Fonts/x.ttf', 'darwin')).toBe(false);
    expect(isExcludedPath('C:\\', 'C:\\Windows\\System32', 'win32')).toBe(true);
    expect(isExcludedPath('C:\\', 'C:\\Program Files (x86)\\App', 'win32')).toBe(true);
    expect(isExcludedPath('C:\\', 'C:\\Users\\niyam\\AppData\\Local', 'win32')).toBe(true);
    expect(isExcludedPath('C:\\', 'C:\\Users\\niyam\\Desktop', 'win32')).toBe(false);
    expect(isExcludedPath('D:\\', 'D:\\Work', 'win32')).toBe(false);
    expect(isExcludedPath('/', '/proc/1', 'linux')).toBe(true);
    expect(isExcludedPath('/', '/home/me/notes.txt', 'linux')).toBe(false);
  });

  it('places folders at their full path under the device folder', () => {
    expect(remotePathFor('/Users/me/Desktop/test', 'darwin')).toBe('Users/me/Desktop/test');
    expect(remotePathFor('/', 'darwin')).toBe('');
    expect(remotePathFor('/Volumes/USB/Photos', 'darwin')).toBe('Volumes/USB/Photos');
    expect(remotePathFor('C:\\Users\\me\\Desktop', 'win32')).toBe('C/Users/me/Desktop');
    expect(remotePathFor('d:\\', 'win32')).toBe('D');
    expect(remotePathFor('\\\\nas\\share\\docs', 'win32')).toBe('nas/share/docs');
  });
});
