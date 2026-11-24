# Cloud Disk

Multi-tenant organizational cloud storage (Windows "This PC"-style explorer) backed by Backblaze B2.

| Directory | Contents |
|---|---|
| `coude-disk-bakend/` | Spring Boot 4.1 / Java 21 / Maven / Flyway backend (conventions: `coude-disk-bakend/agent.md`). |
| `cloud-disk-frontend/` | User application — React 19, TypeScript, Vite, Redux Toolkit + RTK Query, Fluent UI v9. Port 5173. |
| `cloud-disk-super-admin-frontend/` | Platform admin console, same stack. Port 5174. |
| `cloud-disk-docs-frontend/` | Docs app: a Google Docs-style home (recent documents, search, new document) and the document editor. Separate site (port 5177; its own subdomain in production); documents are saved to the storage through the same API. |
| `docs/implementation-plan.md` | Architecture, approved decisions, milestone log. |
| `docs/deployment.md` | Production configuration, TLS, first-start checklist, operations. |
| `docs/document-editors-research.md`, `docs/editor-docs-feature-set.md` | In-browser editors: market research, architecture, and the approved Docs editor scope. |
| `prompt.txt` | History of project prompts. |

## Status

All twelve milestones are complete. Deployment: `docs/deployment.md`. Known gaps before a commercial launch are listed there (§7). See `docs/implementation-plan.md` §16.

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
- Files upload straight from the browser to storage. With the local storage adapter the upload URLs point at this backend (`STORAGE_LOCAL_PUBLIC_URL`, default `http://localhost:8080`).
- Swagger UI: `http://localhost:8080/swagger-ui.html` (disabled in `prod` unless `API_DOCS_ENABLED=true`).

## Frontends

Requires Node 20+.

```bash
cd cloud-disk-frontend            # or cloud-disk-super-admin-frontend
cp .env.example .env.local        # VITE_API_BASE_URL, defaults to http://localhost:8080/api/v1
npm ci
npm run dev
```

Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

The frontends hide actions a user cannot perform, but every permission is enforced by the backend.

Opening a Word document in the user app (double-click, Enter, or Open) opens it in a new tab in the Docs app (`VITE_DOCS_APP_URL`); other files are downloaded. "New document" in a folder opens the Docs app, which creates the file in that folder. The Docs app has no sign-in of its own: it uses the portal's session (it sends signed-out users to the portal's sign-in page and back). The editors are separate npm packages in `cloud-disk-docs-frontend/editors/`: `editor-core` (shared shell: save status, one editor at a time, autosave as versions, version history), `editor-docs` (Word documents, Tiptap based, saves .docx; Markdown/text/PDF export, AI writing tools) and `editor-preview` (images, video, audio, PDF, text, for direct links). Docs editor scope and roadmap: `docs/editor-docs-feature-set.md`.
