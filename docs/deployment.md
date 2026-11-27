# HarDisk — Deployment guide

This guide describes a production deployment. Nothing here has been executed against production; deploying is the owner's decision.

## 1. Components

| Component | Artifact | Notes |
|---|---|---|
| API | `coude-disk-bakend` → `target/cloudrive-*.jar` (Java 21) | Stateless; run 2+ instances behind a load balancer. Flyway migrates the schema on startup. |
| User app | `cloud-disk-frontend/dist` (static) | Served over HTTPS. |
| Super Admin console | `cloud-disk-super-admin-frontend/dist` (static) | Serve on a separate host name; restrict by network/VPN if possible. |
| Database | MySQL 8, database `cloud_disk` | `utf8mb4`; daily backups + binlog for point-in-time recovery. |
| Object storage | Backblaze B2 (S3-compatible) | One private bucket per organization by default (100 buckets per account unless raised). |
| Email | Empedance mail API | `MAIL_API_KEY` required in prod. |

The refresh cookie is `SameSite=Strict`, so the API and both frontends must be **same-site** (e.g. `api.example.com`, `app.example.com`, `admin.example.com`).

## 2. Build

```bash
cd coude-disk-bakend && ./mvnw clean verify
```

```bash
cd cloud-disk-frontend && npm ci && npm run typecheck && npm run lint && npm test && VITE_API_BASE_URL=https://api.example.com/api/v1 npm run build
```

```bash
cd cloud-disk-super-admin-frontend && npm ci && npm run typecheck && npm run lint && npm test && VITE_API_BASE_URL=https://api.example.com/api/v1 npm run build
```

## 3. API configuration (`SPRING_PROFILES_ACTIVE=prod`)

All values come from the environment or a secret manager; nothing secret is committed.

| Variable | Required | Purpose |
|---|---|---|
| `PROD_DB_URL`, `PROD_DB_USERNAME`, `PROD_DB_PASSWORD` | yes | MySQL connection (least-privilege user: DML + DDL on `cloud_disk` for Flyway). |
| `JWT_SECRET` | yes | ≥ 32 random bytes (`openssl rand -base64 48`). Rotating it signs everyone out. |
| `CORS_ALLOWED_ORIGINS` | yes | Exact origins of every frontend (portal, admin console, Docs, Sheets and Images apps), comma-separated. |
| `FRONTEND_BASE_URL` | yes | User app URL used in emails (verification, invitations, share links). |
| `MAIL_API_KEY` (+ `MAIL_API_URL`) | yes | Startup fails without it in prod. Super Admin sign-in codes are sent by email, so mail must work before staff can sign in. |
| `B2_S3_ENDPOINT`, `B2_REGION`, `B2_KEY_ID`, `B2_APPLICATION_KEY` | yes | Key needs bucket create/write capabilities. |
| `STORAGE_BUCKET_PREFIX` | yes | Globally unique prefix, e.g. `cd-prod-acme`. |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` | first start only | Creates the first Super Admin; remove afterwards. Use a real mailbox: every Super Admin sign-in needs the emailed code. |
| `PAYMENT_PROVIDER`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | yes | Razorpay is the production default. Use Live Mode keys. In the Razorpay Dashboard add a webhook to `https://<api host>/api/v1/payments/razorpay/webhook` with events payment.captured, payment.authorized, payment.failed and order.paid, using the same webhook secret. |
| `INVOICE_SELLER_NAME`, `INVOICE_SELLER_ADDRESS`, `INVOICE_SELLER_GSTIN`, `INVOICE_SELLER_EMAIL`, `INVOICE_LOGO_PATH` | no | Printed on PDF invoices. Address lines are separated by ";". The logo is a PNG or JPEG file readable by the API (for example a mounted volume); without it the logo space shows a dashed placeholder. Set the GSTIN so GST bills are titled "Tax invoice". |
| `RATE_LIMIT_PER_MINUTE` | optional | Default 30 per IP per public endpoint group, per instance. |
| `API_DOCS_ENABLED` | optional | Swagger stays off in prod unless `true`. |

Fixed by the prod profile: secure refresh cookie, `app.dev-tools.enabled=false`, `app.payment.provider=none` (purchases return 503 until a real payment provider is integrated), `server.forward-headers-strategy=native`.

## 4. Network and TLS

- Terminate TLS at the load balancer/reverse proxy; forward `X-Forwarded-For`/`-Proto` (needed for client IPs in rate limits and audit, and for HSTS).
- Expose only `/api/**` publicly. Block `/api/v1/dev/**` and `/api/v1/dev-storage/**` at the proxy as defence in depth (they do not exist in prod).
- Static hosts: send `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a CSP such as `default-src 'self'; connect-src 'self' https://api.example.com https://*.backblazeb2.com; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`. Single-page fallback: unknown paths serve `index.html`.
- The B2 buckets receive CORS rules for `CORS_ALLOWED_ORIGINS` automatically during provisioning (browser uploads/downloads use presigned URLs).

## 5. First start checklist

1. Create the empty `cloud_disk` database and user; start one API instance and confirm Flyway reaches the latest version (`flyway_schema_history`).
2. Sign in to the Super Admin console with the bootstrap account (enter the emailed code), then remove the bootstrap variables.
3. Publish global pricing (Pricing page) — nothing is seeded, so purchases are refused until then.
4. Register a test organization, verify the email, watch provisioning reach ACTIVE (Organizations page), and check the bucket in B2.
5. Scale out to more instances.

## 6. Operations

- **Backups:** MySQL daily full + binlogs; B2 keeps object versions (deletes use explicit version ids). Test restores quarterly.
- **Monitoring:** alert on HTTP 5xx rate, `STORAGE_PROVISIONING_FAILED`, `STORAGE_OPERATION_FAILED`, `REFRESH_TOKEN_REUSE`, `RATE_LIMITED` and `LOGIN_MFA_FAILURE` spikes (Security events page or `audit_events`).
- **Schedulers** (provisioning, upload expiry, storage outbox) run on every instance. Provisioning jobs and storage operations are claimed with conditional updates, and upload expiry runs under the drive row lock with optimistic locking, so several instances can run them.
- **Rate limiting** is in-memory per instance; for strict global limits add one at the proxy/WAF.
- **Secrets rotation:** `JWT_SECRET` (signs everyone out), `B2_APPLICATION_KEY`, `MAIL_API_KEY`, DB password — via the secret manager, then rolling restart.

## 7. Known gaps before a commercial launch

- Razorpay must be configured (keys and webhook) before launch: when a free trial ends, features are paused until the yearly bill is paid, so without a payment provider no organization can continue. Publish pricing in INR (unless the Razorpay account has international payments enabled) together with the trial settings. The billing job runs every 5 minutes (`app.billing.poll-ms`). Database migration `V22` is additive except that it drops the one-bill-per-period unique constraint; on the first run after deploying it, every existing organization gets a fresh trial, keeps its storage and is unblocked, and earlier unpaid bills stay payable. Back up the database before deploying, and deploy the backend, user app, admin app and landing site together (the billing API changed).
- Restricted share links require recipients with accounts; no email one-time codes.
- The Super Admin second factor is an emailed code, so it is only as strong as that mailbox; protect staff mailboxes with their own MFA.
- Rate limits are per instance.

## AI features and editors

- AI is off unless `AI_PROVIDER=groq` with `GROQ_API_KEY`, `AI_MODEL_FAST` and `AI_MODEL_SMART` are set (see `coude-disk-bakend/.env.example`). Use current model names from the provider's list. Put the key only in the environment or the gitignored `.env`; it never reaches the browser. Document text a user sends to an AI action goes to the provider, so say so in your privacy terms.
- Editing images by prompt is off unless `AI_IMAGE_PROVIDER=cloudflare` with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (a token with the Workers AI permission) are set; `AI_IMAGE_MODEL` defaults to `@cf/black-forest-labs/flux-2-klein-4b`. Limits: `AI_IMAGE_MONTHLY_EDITS_PER_ORG` (default 200 successful edits per organization per month), `AI_IMAGE_MAX_INPUT_BYTES` (default 4 MB) and `AI_IMAGE_MAX_CONCURRENT` (default 4); the per-user `AI_USER_REQUESTS_PER_MINUTE` also applies. The picture a user edits goes to Cloudflare for that edit only; say so in your privacy terms. Cloudflare's free plan gives 10,000 Neurons a day (about 100 edits); beyond it the Workers paid plan bills $0.011 per 1,000 Neurons.
- Each organization's owner turns AI on under AI settings; a Super Admin can block it or set a monthly token limit per organization. Defaults: `AI_DEFAULT_MONTHLY_TOKENS_PER_ORG=2000000`, `AI_USER_REQUESTS_PER_MINUTE=20`, `AI_MAX_CONCURRENT=16`. Rate and concurrency limits count per server instance. Only usage counts are stored (`ai_usage`).
- Editors keep up to `EDITOR_MAX_VERSIONS` (100) versions per file; older versions are deleted and stop counting toward storage. Editor saves are limited to `FILES_MULTIPART_THRESHOLD_BYTES` (100 MB). The edit lock lasts `EDITOR_LOCK_TTL_SECONDS` (120) without a heartbeat.
- If the browser reaches the API from another origin, `CORS_ALLOWED_ORIGINS` must include it; the API already allows the `X-Lock-Token` header the editors use.

## Docs app (separate frontend)

- `cloud-disk-docs-frontend` is its own site (port 5177 in development; give it its own subdomain, for example docs.example.com). Build it with `npm run build` and serve the `dist` folder like the other frontends. Build-time settings: `VITE_API_BASE_URL` (the API) and `VITE_PORTAL_URL` (the storage portal, used for sign-in and "Storage" links). The storage portal needs `VITE_DOCS_APP_URL` (the Docs app's address) so that .docx files open there.
- `cloud-disk-sheets-frontend` is likewise its own site (port 5178; for example sheets.example.com), built the same way with `VITE_API_BASE_URL` and `VITE_PORTAL_URL`. The storage portal needs `VITE_SHEETS_APP_URL` so spreadsheets open there, and the API's `CORS_ALLOWED_ORIGINS` and each bucket's CORS rules must include the Sheets origin (as for Docs). The Univer engine is a separate lazy chunk of about 1.9 MB gzipped, loaded only when a spreadsheet opens.- It has no sign-in page of its own: it reuses the portal's session. The refresh cookie is `SameSite=Strict` on the API, so the portal, the Docs app and the API must share one site (for example app.example.com, docs.example.com and api.example.com). Someone who is not signed in is sent to the portal's sign-in page and returns afterwards.
- `cloud-disk-images-frontend` is likewise its own site (port 5179; for example images.example.com), built with `VITE_API_BASE_URL` and `VITE_PORTAL_URL`. The storage portal needs `VITE_IMAGES_APP_URL` so images open there; `CORS_ALLOWED_ORIGINS` and each bucket's CORS rules must include the Images origin. The editor chunk is about 60 KB gzipped; the HEIC decoder (about 350 KB gzipped) loads only when a HEIC file is opened.
- Add the Docs app's exact origin to `CORS_ALLOWED_ORIGINS`. Storage buckets get their CORS rules from that list when an organization is provisioned, so organizations provisioned before the Docs origin was added need their bucket rules updated (retry provisioning from the Super Admin console) before browsers can load or save files from the Docs app.


## Large file sharing (landing site)

The marketing site (`cloud-disk-landing`) lets anyone send up to 50 GB without an account; files are kept 15 days and then deleted.

- **Separate storage and credentials.** Create one dedicated Backblaze bucket (private) and an application key restricted to *that bucket only* (capabilities: listBuckets, readFiles, writeFiles, deleteFiles; add writeBucketSettings only if you let the backend configure CORS). Set `TRANSFER_STORAGE_PROVIDER=b2`, `TRANSFER_B2_S3_ENDPOINT`, `TRANSFER_B2_REGION`, `TRANSFER_B2_KEY_ID`, `TRANSFER_B2_APPLICATION_KEY`, `TRANSFER_B2_BUCKET`. The organization-storage `B2_*` values are never used for transfers. Leave `TRANSFER_STORAGE_PROVIDER` empty to switch the feature off (its endpoints answer 503).
- **Browser origin.** Set `TRANSFER_PUBLIC_BASE_URL` (the landing site's public URL; emailed links point there) and `TRANSFER_ALLOWED_ORIGINS` (same value). Only these origins may call `/api/v1/public/transfers/**`. The landing site is given no access to any other endpoint.
- **Bucket CORS.** Browsers PUT parts straight to the bucket, so it needs CORS allowing PUT/GET/HEAD from the landing origin with `ETag` exposed. Either set `TRANSFER_B2_CONFIGURE_BUCKET=true` once (the backend applies CORS + encryption at startup; best effort, logs a warning on failure) or set it in the Backblaze console.
- **Deletion.** `TransferScheduler` (every `TRANSFER_POLL_MS`, 60 s) marks transfers past `expires_at` as expired and deletes each object *version* from the bucket; a transfer becomes DELETED (and its emails/message are erased from the database) only after Backblaze confirmed. Failures back off up to 1 h and retry. Unfinished uploads expire after 24 h (multipart uploads are aborted). As a belt-and-braces safety net you may also add a Backblaze bucket lifecycle rule "hide after 16 days, delete after 17 days".
- **Abuse limits.** Per IP: 10 new transfers/hour (`TRANSFER_MAX_CREATIONS_PER_HOUR`) and a 10x-the-usual per-minute request budget for the transfer endpoints. Server-side: ≤ 100 files and ≤ 53,687,091,200 bytes in total; each uploaded file's real size is checked against what was declared and the whole transfer is deleted on mismatch. Known gap: the sender's email is not verified, so emailed links can be abused for spam at a low rate - consider email verification (code) before scaling this up.
- Landing site env: `NEXT_PUBLIC_API_URL` (the API, e.g. `https://api.example.com/api/v1`), `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`.
- **Unfinished-feature flag (Docs and Sheets apps).** Both apps have buttons and menus for features that are not built yet (Star, Move, Comments, Meet, Share without a link, Paint format, Extensions, Help, Borders, Insert chart, …). They are hidden by default. Set `VITE_SHOW_UNFINISHED_FEATURES=true` in the app's `.env` (build-time) to show them as greyed "Coming soon" controls; `false` or unset hides them. The Images editor has no such controls, so it has no flag.
- The Images app also plays videos (any extension; what the browser cannot decode falls back to Download). Videos stream directly from storage, so each bucket's CORS rules must allow `GET` with `Range` requests from the Images origin.
