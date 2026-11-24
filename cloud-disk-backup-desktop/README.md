# HarDisk Backup (desktop)

Keeps chosen folders on a computer backed up to a HarDisk drive, automatically.

## How it works

1. **Sign in** with your HarDisk organization account (the API address can be changed under *Server*).
2. **Choose a drive** you can upload to and register this computer as a **device**. The server creates
   `Backup/<computer name> (<8-character id>)` at the root of that drive. On another computer you can instead
   **continue** an existing device: both computers then back up into the same device folder.
3. **Choose what to back up** — either:
   - **Specific folders** (the default): pick one or more folders (several at once in the picker). Each gets its own
     folder inside the device folder; nothing else on the computer is touched.
   - **Entire computer**: every disk (Windows drive letters; on macOS the startup disk and mounted volumes; on Linux `/`
     and mounted media), each in its own folder. System files, installed apps, caches and app data are skipped
     (`isSystemArea` in `src/main/backup/rules.ts`; e.g. `/System`, `/Applications`, `~/Library`, `C:\Windows`,
     `C:\Program Files`, `%USERPROFILE%\AppData`). On macOS, protected folders need Full Disk Access.

   You can switch later with the *Selected folders / Entire computer* toggle on the dashboard. Switching to the entire
   computer replaces the selected folders (they are inside the disks anyway); switching back stops the disks. Files
   already backed up always stay in HarDisk.

   Every folder is stored at its **full path** under the device folder, so the backup mirrors the computer. Example for
   user 1 with drive D, after choosing `/Users/niyam/Desktop/test` (Windows: `C:\Users\niyam\Desktop\test` → `C/Users/niyam/Desktop/test`):

   ```
   D:\Backup\Niyams-MacBook-Pro (3f031a8a)\Users\niyam\Desktop\test\Reports\q1.xlsx
   ```

   Choosing a **parent folder later** (here `Desktop`) takes over the folders already backed up inside it: they are
   already in the right place in the drive, their local record of uploaded files moves to the parent, and only new or
   changed files are uploaded (the server also answers UNCHANGED for a file with the same size that was not modified
   since it was stored). Choosing a folder that is **already inside** a backed-up folder just says it is included.
   Switching to *Entire computer* takes over the selected folders the same way.

After the first full pass, new and changed files are picked up from file-system events (and a rescan every 15 minutes
as a safety net). Changed files become new versions of the stored file. Deleting a file on the computer never deletes
it from the backup; removing a folder only stops backing it up. Closing the window keeps the app running in the menu bar
/ system tray; *Start when I sign in* is in Settings.

Skipped automatically: OS and editor scratch files (`.DS_Store`, `Thumbs.db`, `~$*.docx`, `*.tmp`, partial downloads, …),
symbolic links, and names HarDisk cannot store (`< > : " / \ | ? *`, trailing period). Skips and failures are listed under Activity.

## CCTV cameras

The **Cameras** page records an NVR/DVR's cameras to the cloud as they happen, so that if the recorder is stolen,
damaged or switched off, the recordings up to the last few seconds are safe.

- **Connect:** this computer must be on the recorder's network. Choose the brand (Hikvision/HiLook/Prama,
  Dahua/CP Plus/Amcrest/Lorex, Uniview, or any RTSP address with `{channel}`), IP address, RTSP port (554), the
  recorder's user and password, main or sub stream, and how many cameras. *Test connection* shows a picture from
  channel 1. The password is encrypted with the OS keychain and stays on this computer.
- **Recording:** one ffmpeg per camera copies the stream (no re-encoding, low CPU) into 10-second clips that start on
  the clock (fragmented MP4, so even a clip cut short by a power cut plays). Each finished clip is uploaded straight
  away and deleted locally: the cloud copy is about **10–20 seconds behind live** (shown per camera). Clips go to
  `CCTV/<recorder>/<camera>/<day>/<hour>/<HH-mm-ss>.mp4` in the chosen drive.
- **Offline:** clips wait on this computer (up to 20 GB, oldest dropped beyond that — the recorder still has them) and
  are uploaded oldest first when the connection returns. A stream that drops or stalls is restarted with backoff. The
  computer is kept from sleeping while cameras record.
- **Old recordings:** keep forever, or delete days older than N days (drive managers only; deleted permanently by the
  server every hour).
- **ffmpeg is required.** It is found next to the app, on `PATH`, in Homebrew or `C:\ffmpeg\bin`, from
  `HARDISK_FFMPEG`, or chosen on the Cameras page. Install: `brew install ffmpeg` (macOS), `winget install ffmpeg`
  (Windows), `sudo apt install ffmpeg` (Linux). It is not bundled yet (see Known limits).
- Upload needed: roughly 1–4 Mbit/s per camera on the main stream, a few hundred kbit/s on the sub stream.

Setup offers *CCTV cameras* next to *Specific folders* and *Entire computer*, for a computer that only records cameras.
File backup and camera recording run independently.

## Development

Requires Node 20+ and the backend (see the root README).

```bash
npm ci
npm run dev          # compiles the main process, serves the window with Vite (port 5180) and starts Electron
npm test             # engine, API client and rule tests (Vitest)
npm run lint
npm run typecheck
npm run build        # dist-electron/ (main + preload) and dist/ (window)
npm start            # build, then run the built app
npm run dist         # unsigned installers with electron-builder (release/)
```

Environment (`.env.example`): `HARDISK_API_URL` (default `http://localhost:8080/api/v1`), `HARDISK_WEB_URL` (the portal
opened from Settings, default `http://localhost:5173`), `HARDISK_USER_DATA` (separate data folder, for testing).
Opening `http://localhost:5180` in a plain browser shows the window with an in-memory stand-in for the main process
(`src/renderer/app/mockBridge.ts`, development builds only) — handy for working on the screens without a backend.

## Structure

| Path | What |
|---|---|
| `src/main/main.ts` | App lifecycle, window, tray, IPC handlers, device/session handling |
| `src/main/api.ts` | REST client: login (refresh token from the `cd_refresh` cookie), single-flight refresh, typed calls |
| `src/main/config.ts` | Settings file and the refresh token encrypted with the OS keychain (`safeStorage`) |
| `src/main/backup/engine.ts` | Scan, watch, queue (3 parallel uploads), retries, activity, status |
| `src/main/backup/uploader.ts` | Single PUT or multipart upload straight to storage, then complete (abort on failure) |
| `src/main/backup/fileIndex.ts` | Per-folder index (size + modified time) so restarts only send changes |
| `src/main/backup/rules.ts` | Ignore list, name rules, content types, idempotency keys |
| `src/main/cctv/engine.ts` | CCTV: one ffmpeg per camera, finished-clip pickup, upload queue, offline spool, restarts, status |
| `src/main/cctv/manager.ts` | CCTV recorders of the signed-in member: local connection details, encrypted passwords, server sync |
| `src/main/cctv/ffmpeg.ts`, `streams.ts` | Finding ffmpeg, recording/snapshot arguments, brand RTSP addresses, password redaction |
| `src/preload/preload.ts` | `window.hardisk` bridge (context isolation, sandboxed window, no Node in the window) |
| `src/renderer/` | React + Redux Toolkit window: sign in, setup, dashboard (overview, cameras, activity, settings) |
| `src/shared/types.ts` | Types shared by all three |

Backend API: `/api/v1/backup/**` and `/api/v1/cctv/**`, documented in `coude-disk-bakend/agent.md` ("Desktop backup", "CCTV cloud recording").

## Security

- The access token stays in the main process memory; the refresh token is stored only encrypted by the OS keychain.
  Where no keychain is available it is kept in memory and you sign in again after a restart.
- The window has no Node.js access, cannot navigate away, and opens web links in the default browser.
- File bytes go directly to storage through short-lived presigned URLs; the API never sees them.

## Known limits

Unsigned builds and no auto-update yet; no bandwidth limit or custom exclusions; a renamed or moved file is uploaded
again under its new path (the old copy stays in the backup); members with Contributor access can add files but not
update changed ones (Editor needed).

CCTV: ffmpeg is not bundled (packaging it needs a licence decision: LGPL builds are fine to ship, GPL builds impose
GPL terms); recorders are recorded from the computer that added them (another computer cannot take one over yet);
H.265 cameras record fine but most browsers only play H.264 clips; the recording computer itself should be kept away
from the recorder, or one theft takes both.
