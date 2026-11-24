import { open } from 'node:fs/promises';
import type { ApiClient, UploadSession } from '../api';

/** Parts whose URLs are requested in one call (the API allows up to 100). */
const URL_BATCH = 50;

async function readRange(path: string, start: number, length: number): Promise<Uint8Array> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(buffer, offset, length - offset, start + offset);
      if (bytesRead === 0) throw new Error('The file got shorter while it was being uploaded.');
      offset += bytesRead;
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

/**
 * Sends a file's bytes for an upload session straight to storage (single PUT, or parts for large files), then completes
 * it. On failure the session is aborted so the drive's reserved space is released.
 */
export async function uploadFile(api: ApiClient, session: UploadSession, path: string, sizeBytes: number,
                                 onProgress: (sentBytes: number) => void): Promise<void> {
  try {
    if (session.mode === 'SINGLE') {
      if (!session.uploadUrl) throw new Error('The upload has no URL.');
      await api.putBytes(session.uploadUrl, await readRange(path, 0, sizeBytes), session.contentType);
      onProgress(sizeBytes);
      await api.completeUpload(session.id);
      return;
    }
    const parts: { partNumber: number; etag: string }[] = [];
    let sent = 0;
    for (let first = 1; first <= session.partCount; first += URL_BATCH) {
      const numbers = Array.from({ length: Math.min(URL_BATCH, session.partCount - first + 1) }, (_, i) => first + i);
      for (const { partNumber, url } of await api.partUrls(session.id, numbers)) {
        const start = (partNumber - 1) * session.partSize;
        const length = Math.min(session.partSize, sizeBytes - start);
        const etag = await api.putBytes(url, await readRange(path, start, length));
        if (!etag) throw new Error('Storage did not confirm a part of the file.');
        parts.push({ partNumber, etag });
        sent += length;
        onProgress(sent);
      }
    }
    await api.completeUpload(session.id, parts.sort((a, b) => a.partNumber - b.partNumber));
  } catch (error) {
    await api.abortUpload(session.id).catch(() => undefined);
    throw error;
  }
}
