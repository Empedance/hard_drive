# HarDisk

Multi-tenant organizational cloud storage (Windows "This PC"-style explorer) backed by Backblaze B2.

| Directory | Contents |
|---|---|
| `coude-disk-bakend/` | Spring Boot 4.1 / Java 21 / Maven / Flyway backend (conventions: `coude-disk-bakend/agent.md`). |
| `cloud-disk-frontend/` | User application — React 19, TypeScript, Vite, Redux Toolkit + RTK Query, Fluent UI v9. Port 5173. |
| `cloud-disk-super-admin-frontend/` | Platform admin console, same stack. Port 5174. |
| `cloud-disk-docs-frontend/` | Docs app: a Google Docs-style home (recent documents, search, new document) and the document editor. Separate site (port 5177; its own subdomain in production); documents are saved to the storage through the same API. |
| `cloud-disk-sheets-frontend/` | Sheets app: spreadsheet home and editor (Univer + our own .xlsx/.csv converters). Separate site (port 5178); files are saved to the storage through the same API. |
| `cloud-disk-images-frontend/` | Images app: photo home and editor (crop, rotate, resize, adjust, looks, HSL, curves, before/after, edit by prompt with AI). Separate site (port 5179); images are saved to the storage through the same API. Light theme by default with a sun/moon toggle in the header (like Docs and Sheets). |
| `cloud-disk-landing/` | Public marketing / landing site — Next.js 16, Tailwind, Zustand. Port 3000. Also hosts **large file sharing** (`/send`, `/d/<link>`: up to 50 GB, kept 15 days, own storage credentials `TRANSFER_B2_*`); needs the backend. See its README. |
| `docs/implementation-plan.md` | Architecture, approved decisions, milestone log. |
| `docs/deployment.md` | Production configuration, TLS, first-start checklist, operations. |
| `docs/document-editors-research.md`, `docs/editor-docs-feature-set.md`, `docs/editor-sheets-feature-set.md`, `docs/editor-images-feature-set.md` | In-browser editors: market research, architecture, and the scope of each editor (Images: also the image-AI provider comparison). |
| `prompt.txt` | History of project prompts. |

## Status

All twelve milestones are complete. Deployment: `docs/deployment.md`. Known gaps before a commercial launch are listed there (§7). See `docs/implementation-plan.md` §16.

## Run everything for development

```bash
./dev.sh            # backend (8080) + all frontends (incl. landing site)
./dev.sh status     # what is up
./dev.sh start api web   # only some services (api web admin docs sheets images landing)
./dev.sh stop
```

Logs go to `.dev-logs/` (gitignored). Needs MySQL running and `coude-disk-bakend/.env` set up (below). Ports already in use are skipped.

## Backend

Requires Java 21+ and MySQL 8 (for the default `local` profile).

```bash
cd coude-disk-bakend
cp .env.example .env    # then set DB_PASSWORD and JWT_SECRET
./mvnw clean test
./mvnw spring-boot:run
```

- Configuration comes only from environment variables or the gitignored `.env`; there are no default secrets. `JWT_SECRET` is mandatory.
- The schema is created by Flyway (`src/main/resources/db/migration`) in database `cloud_disk`; Hibernate only validates it.
- Email: `MAIL_PROVIDER=log` (default in local/dev) prints emails, including verification and invitation links, to the console. `MAIL_PROVIDER=empedance` with `MAIL_API_KEY` sends real email through the Empedance mail API (the default in `prod`).
- Storage: `STORAGE_PROVIDER=local` (default in local/dev) keeps buckets as folders in `./storage-local`. `STORAGE_PROVIDER=b2` with `B2_S3_ENDPOINT`, `B2_REGION`, `B2_KEY_ID`, `B2_APPLICATION_KEY` uses Backblaze B2 (the default in `prod`). New organizations become active once their storage is provisioned, which takes about 10 seconds.
- Drives need purchased storage. The owner buys it on Organization › Billing once a Super Admin has published pricing (`POST /api/v1/admin/pricing`; nothing is seeded). Locally `PAYMENT_PROVIDER=dev` marks invoices paid without charging; `PAYMENT_PROVIDER=razorpay` takes real payments (the `prod` default). Owners and Super Admins can download any bill as a PDF invoice. Before any subscription exists, the development-only capacity grant on Organization › Drives (`DEV_TOOLS_ENABLED`, never in `prod`) still works.
- In-browser editors (Docs first; see `docs/editor-docs-feature-set.md`) use `GET /api/v1/files/{id}/content` (inline URL, current version, edit rights), an edit session per file (`POST|PUT|DELETE /api/v1/files/{id}/edit-session`, one editor at a time) and saves as new versions (`POST /api/v1/files/{id}/versions`, then `POST /api/v1/uploads/{id}/complete`; 409 if someone saved a newer version). History: `GET /api/v1/files/{id}/versions`, restore with `POST .../versions/{versionId}/restore`. Older versions count toward drive storage until dropped (`EDITOR_MAX_VERSIONS`).
- AI features in the editors (`docs/editor-docs-feature-set.md`): `AI_PROVIDER=groq` with `GROQ_API_KEY`, `AI_MODEL_FAST` and `AI_MODEL_SMART` (see `.env.example`; `AI_PROVIDER=none` is the default and switches AI off for the platform). The key stays on the server. Each organization's owner turns AI on under AI settings; a Super Admin can block it or set a monthly token limit on the organization page. Only usage counts are stored, never text. `POST /api/v1/ai/run` streams the answer as server-sent events.
- Sharing with people (`POST /api/v1/files/{id}/shares`, body `userId`, `accessLevel` VIEWER|EDITOR, `accessMode` DIRECT|TWO_FACTOR; sharing again with the same person changes both). VIEWER can view and download; EDITOR can also edit the contents of files in the in-browser editors (never rename, move or delete: those still need drive access). DIRECT works at once. TWO_FACTOR needs an unlock first: the grantee calls `POST /api/v1/shares/{id}/access-requests` with `days` (1 to 90; the UI offers 1, 3, 7, 30 and custom), a 6-digit OTP is emailed to the person who shared (valid 15 minutes, 5 attempts, one request a minute, stored salted and hashed), the grantee enters it at `POST /api/v1/shares/{id}/access-requests/verify`, and access lasts the chosen number of days. Afterwards it is gone and a new OTP is needed. Until unlocked, content, edit-session, save, AI and shared download calls answer 403 with `error.code = TWO_FACTOR_REQUIRED` and `error.shareId`. `GET /api/v1/shares/{id}/access` shows the state. In the portal: People tab of the Share dialog (level and mode), Shared with me (unlock dialog).
- Files upload straight from the browser to storage. With the local storage adapter the upload URLs point at this backend (`STORAGE_LOCAL_PUBLIC_URL`, default `http://localhost:8080`).
- Swagger UI: `/swagger-ui.html` on whichever host serves the API, e.g. `http://localhost:8080/swagger-ui.html` (disabled in `prod` unless `API_DOCS_ENABLED=true`). Its server is the relative URL `/`, so "Try it out" always calls the origin the page was opened from, on local, dev, stage or behind a proxy. Click **Authorize** once with an access token (the `accessToken` from `POST /api/v1/auth/login`); it is remembered across reloads. The raw spec is at `/v3/api-docs`.

## Frontends

Requires Node 20+.

```bash
cd cloud-disk-frontend            # or cloud-disk-super-admin-frontend
cp .env.example .env.local        # VITE_API_BASE_URL, defaults to http://localhost:8080/api/v1
npm ci
npm run dev
```

Sign-in pages (portal and Super Admin console) share one split-screen layout, `src/components/AuthShell.tsx` + `auth-shell.css` (icons from `lucide-react`; the Docs, Sheets and Images apps send signed-out users to the portal's page). Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

The frontends hide actions a user cannot perform, but every permission is enforced by the backend.

Opening a Word document in the user app (double-click, Enter, or Open) opens it in a new tab in the Docs app (`VITE_DOCS_APP_URL`); other files are downloaded. "New document" in a folder opens the Docs app, which creates the file in that folder. The Docs app has no sign-in of its own: it uses the portal's session (it sends signed-out users to the portal's sign-in page and back). The editors are separate npm packages in `cloud-disk-docs-frontend/editors/`: `editor-core` (shared shell: save status, one editor at a time, autosave as versions, version history), `editor-docs` (Word documents, Tiptap based, saves .docx; Markdown/text/PDF export, AI writing tools) and `editor-preview` (images, video, audio, PDF, text, for direct links). Docs editor scope and roadmap: `docs/editor-docs-feature-set.md`.

Spreadsheets (.xlsx, .xlsm, .xls, .csv, .ods) open the same way in the Sheets app (`VITE_SHEETS_APP_URL`, port 5178); "New spreadsheet" in a folder opens `/new` there. .xlsx and .csv are edited and saved in their own format; .xls, .ods and .xlsm are view-only with "Save as .xlsx copy". The app is `cloud-disk-sheets-frontend` (Univer core, no Univer Pro; our own ExcelJS converter keeps a hidden `cloud-disk/workbook.json` part so our own files reopen exactly). The six spreadsheet AI features (`sheets.formula`, `.explain`, `.analyze`, `.table`, `.clean`, `.chart`) use the same `POST /api/v1/ai/run` and switches as Docs. Backend `CORS_ALLOWED_ORIGINS` must include `http://localhost:5178`. Scope and fidelity targets: `docs/editor-sheets-feature-set.md`.

Images (.jpg, .jpeg, .png, .webp, .gif, .heic, .heif, .avif, .bmp) open the same way in the Images app (`VITE_IMAGES_APP_URL`, port 5179; `cloud-disk-images-frontend`). Tools: rotate, flip, crop (free and presets), resize, ten adjustments, eleven looks with strength, HSL and curves, undo/redo, before/after. Saving is explicit: **Save** stores a new version of JPEG, PNG and WebP files (the original upload stays in version history); **Save as copy** writes a new file next to it (GIF, HEIC, AVIF and BMP are always saved as a copy, as PNG or JPEG). **Edit by prompt** ("remove the background", "add snow") goes through `POST /api/v1/ai/images/edit` to an image provider on the server: Cloudflare Workers AI with FLUX.2 [klein] 4B (free plan: 10,000 Neurons a day, roughly 100 edits). Set `AI_IMAGE_PROVIDER=cloudflare`, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in `coude-disk-bakend/.env` (see `.env.example`); the organization owner's AI switch applies, and each organization has a monthly image-edit limit. Backend `CORS_ALLOWED_ORIGINS` must include `http://localhost:5179`. Scope and the provider comparison: `docs/editor-images-feature-set.md`.
