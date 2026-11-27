# HarDisk — Phase 1 Findings and Implementation Plan

Status: **Approved with recommended defaults** (2026-10-28). Milestones 1–9 complete — see §16.

---

## 1. Repository as it actually exists

| Directory | State |
|---|---|
| `CLAUDE.md` | Engineering rules (Spring Boot + Maven, React + TS + Vite + **Redux**, MySQL + **Flyway**, DTOs, no secrets, tests). |
| `coude-disk-bakend/` | Spring Boot backend skeleton (auth + users only). |
| `cloud-disk-frontend/` | Empty except a Vite-style `.gitignore`. |
| `cloud-disk-super-admin-frontend/` | Empty. |
| `prompt.txt` | Prompt history. |

The instructions refer to `one-drive-bakend/`, `one-drive-frontend/` and `one-drive-super-admin-frontend/`. The real directories are named as above (including the `coude` spelling). Per the "do not rename" rule, all work goes into the **existing** directory names. The repository is not under git.

## 2. Existing backend — structure and conventions

**Build:** Maven wrapper (Maven 3.9.16), Spring Boot **4.1.1**, Java **21** release target (local JDK is 23), `groupId com.empedance`, `artifactId cloudrive`.
Dependencies: data-jpa, security, webmvc, validation, cache + Caffeine, springdoc-openapi 2.8.13, jjwt 0.12.6, Lombok, H2 (runtime), mysql-connector-j (runtime). Test: data-jpa-test, security-test, webmvc-test.

**Package root:** `com.empedance.dlp` (inherited from an earlier "DLP" project; main class `CloudriveBackend`).

**Layers** (also documented in `coude-disk-bakend/agent.md`):

| Package | Convention observed |
|---|---|
| `controller` | `@RestController`, `/api/v1/...`, `@Tag`/`@Operation`, `@PreAuthorize` per method, returns `ApiResponse<T>`. |
| `services` | Interfaces only. |
| `services/impl` | `@Service` + `@RequiredArgsConstructor`, `@Transactional` on writes, throw `ApiException`. |
| `repo` | Spring Data `JpaRepository<Entity, Long>`. |
| `entity` (+ `entity/base`) | Lombok `@Getter`, protected no-arg ctor, `Long` IDENTITY ids, intent-revealing mutators (`addAuthority`, `revoke`). `BaseAuditableEntity` (created/updated/version) exists but is unused. |
| `dto` | Records grouped in a holder class (`AuthDtos`), with `static from(entity)` mappers. |
| `security` | Stateless JWT (`JwtService`, `JwtAuthenticationFilter`), `UserPrincipal` record, `RoleType` enum, central `Authority` catalog, `RoleAuthorities` role→authority map, per-user added/revoked authorities. |
| `common/api` | `ApiResponse{status,data,error}` envelope, `ErrorInfo{message,description}`. |
| `common/exception` | `ApiException(HttpStatus, message, description)` + `GlobalExceptionHandler`. |
| `config` | `SecurityConfig` (BCrypt 12, stateless), `OpenApiConfig` (also enables caching), `BootstrapAdmin` runner. |

**Configuration:** profile files `application-{local,dev,prod}.properties`, default profile `local`, env-var placeholders.

**Implemented functionality:** register (email/password → `ROLE_EMPLOYEE`), login (15-min access JWT + random 48-byte refresh token), refresh-token rotation, admin get-user, add/revoke authority, assign/remove role. Swagger UI path configured.

**Baseline verification (executed):**
- `./mvnw test` initially **failed**: a stale `target/classes/.../GmrBackend.class` (from before the main class was renamed) produced two `@SpringBootConfiguration` classes.
- `./mvnw clean test` **passed**: 1 test (`DlpApplicationTests.contextLoads`), 0 failures. That is the only test.

## 3. Problems found in the existing backend

These conflict with `CLAUDE.md` or with essential security requirements. Each has a proposed smallest fix (applied in Phase 2 after approval).

| # | Finding | Why it matters | Proposed fix |
|---|---|---|---|
| P1 | `application-local.properties` contains a real-looking MySQL root password; local/base profiles create a bootstrap admin with defaults (`admin`/`1234`) and default JWT secrets. | Violates "never hardcode credentials"; any environment started without env vars gets a known-password admin and a forgeable JWT key. | Remove all literal secrets/defaults; read from env (`.env.example` documented, gitignored `.env`); fail fast at startup when `JWT_SECRET` is missing/short outside `test`. **You should rotate that MySQL password.** |
| P2 | No Flyway; `ddl-auto=update` in every profile including prod. | `CLAUDE.md` requires Flyway; `update` is unsafe in prod. | Add Flyway, `V1__baseline.sql` for existing tables, `ddl-auto=validate`. |
| P3 | `application-prod.properties` uses the H2 driver and dialect. | Prod would not run against MySQL. | Use MySQL driver/dialect. |
| P4 | `POST /auth/register` is public and creates tenant-less users. | HarDisk is organizational; anonymous self-registration into no tenant breaks isolation. | Replace with the organization onboarding flow; members join only by invitation. |
| P5 | `ROLE_ADMIN` holds every authority and `UserController` can edit **any** user, including granting `ROLE_SUPER_ADMIN`. | Cross-tenant privilege escalation once organizations exist. | Split platform roles from organization roles (§6); scope every user-management call to the caller's organization; only platform admins can assign platform roles. |
| P6 | JWT filter authenticates disabled users; login of a disabled user throws an uncaught `DisabledException` → 500. | Deactivation would not revoke access. | Check `isEnabled()` in the filter; map `DisabledException`/`LockedException` to 401/403. |
| P7 | Refresh tokens stored in plaintext; no logout; no session list. | DB leak = session hijack; requirement for "active sessions" and logout. | Store SHA-256 hash, add session metadata, logout and revoke endpoints. |
| P8 | No login rate limiting / lockout; no CORS config. | Brute force; two browser frontends need CORS. | Per-account + per-IP attempt throttling (DB/Caffeine), explicit CORS allow-list from env. |
| P9 | Leftovers from another project: `Leads`, `NearByLocation`, `permitAll` for `/api/v1/leads`, `/home-stats`, `/arena`; `agent.md` describes a `companies` API that does not exist. | Dead public routes and misleading docs. | Remove (needs your OK — `Leads` maps to a table), update `agent.md`. |
| P10 | `GlobalExceptionHandler` turns every unhandled exception (incl. malformed JSON, 405) into a silent 500. | Wrong status codes, no server log. | Add handlers for common Spring MVC exceptions and log unexpected ones (without secrets). |
| P11 | springdoc 2.8.x is the Spring Boot 3 line; the project is on Boot 4. | Swagger UI may not work at runtime. | Verify in Phase 2; move to the springdoc release line for Boot 4 if needed. |

I propose **keeping** the `com.empedance.dlp` package name to avoid churn (rename only if you want it).

## 4. Target architecture (within the existing structure)

One Spring Boot application (no microservices). New code follows the existing layout: entities in `entity`, repos in `repo`, interfaces in `services`, implementations in `services/impl`, record DTOs grouped per feature (`DriveDtos`, `FileDtos`, …), controllers under `/api/v1`. Small additions:

- `services/storage/` — `ObjectStorageService` interface; `impl/B2ObjectStorageService` (production) and `impl/LocalDevObjectStorageService` (clearly-labelled dev/test adapter, filesystem-backed, only active with `app.storage.provider=local`).
- `services/payment/` — `PaymentGateway` interface with a `DevPaymentGateway` (`app.payment.provider=dev`) until a provider is chosen.
- `security/` — `CurrentUser` helper exposing user id + organization id, and a `DrivePermissionEvaluator`.
- `jobs/` — scheduled workers (provisioning retry, upload-session expiry, purge outbox, reconciliation) using MySQL `SELECT … FOR UPDATE SKIP LOCKED` so multiple instances are safe without a new library.

**New dependencies (justified):** `spring-boot-starter-flyway` + `flyway-mysql` (CLAUDE.md), AWS SDK for Java v2 `s3` (B2's S3-compatible API, incl. presigner and multipart — Backblaze documents this SDK), `spring-boot-starter-mail` (verification/invitation emails). Nothing else on the backend.

## 5. Database design (Flyway, MySQL 8)

All tenant tables carry `organization_id` and are always queried by `(id, organization_id)`. Money is stored as `BIGINT` minor units + currency; sizes as `BIGINT` bytes. Every mutable aggregate has a `version` column (optimistic locking), using `BaseAuditableEntity`.

| Table | Key columns |
|---|---|
| `organizations` | name, slug, status (`PENDING_VERIFICATION`, `PROVISIONING`, `PROVISIONING_FAILED`, `ACTIVE`, `SUSPENDED`), `purchased_bytes`, `allocated_bytes` (denormalized sum of drives), `used_bytes`. |
| `organization_registrations` | applicant email, org details, `verification_token_hash`, expires_at, status, attempts. |
| `app_users` (existing) | + `organization_id` (nullable for platform staff), display_name, status, `last_login_at`, failed-login counters. |
| `user_roles`, `user_authorities`, `user_revoked_authorities` (existing) | unchanged. |
| `user_sessions` (replaces `refresh_tokens`) | token_hash, family_id, user_agent, ip, created/last_used/expires/revoked_at. |
| `invitations` | org, email, role, drive grants (JSON), token_hash, expires_at, status. |
| `storage_locations` | org, provider, bucket_name, bucket_id, key_prefix, status, last_error. |
| `provisioning_jobs` | org, step, status, attempts, next_attempt_at, last_error. |
| `drives` | org, letter (unique per org among non-archived), name, `allocated_bytes`, `used_bytes`, `reserved_bytes`, status (`ACTIVE`, `ARCHIVED`, `DELETING`). |
| `drive_members` | drive, user, permission (`VIEWER`, `CONTRIBUTOR`, `EDITOR`, `MANAGER`). |
| `file_nodes` | org, drive, parent_id, type (`FOLDER`/`FILE`), name, name_key (normalized; NULL when trashed so the unique `(drive_id, parent_id, name_key)` index ignores trash), materialized `path` (`/12/40/`), size, mime, category (`IMAGE`, `DOCUMENT`, `VIDEO`, `OTHER`), object_key, object_version_id, sha256, status (`PENDING`, `ACTIVE`, `TRASHED`, `PURGING`, `PURGED`), trashed_at/by, original_parent_id. |
| `upload_sessions` | node, idempotency_key, multipart upload_id, part size, expected size, reserved_bytes, expires_at, status. |
| `storage_operations` (outbox) | org, type (`DELETE_OBJECT`, `COPY_OBJECT`, `ABORT_MULTIPART`, `DELETE_BUCKET`), payload, status, attempts, next_attempt_at. |
| `favorites`, `recent_items` | user + node (+ last_accessed_at). |
| `node_shares` | internal share to a user: node, grantee, permission. |
| `share_links` | node, `token_hash`, permission (`VIEW`, `DOWNLOAD`), expires_at, revoked_at, password_hash, restricted (bool) + `share_link_recipients`. |
| `pricing_configs` | price_per_tb_minor, currency, billing_interval, tax_rate_bps, min_tb, max_tb, effective_from, active, created_by. |
| `organization_pricing_overrides` | org, price_per_tb_minor, valid_from/valid_to, reason, created_by. |
| `subscriptions` | org, capacity_tb, interval, status, period start/end, **pricing snapshot** (unit price, tax rate, source = GLOBAL/OVERRIDE + id). |
| `invoices`, `invoice_lines`, `payments` | snapshot amounts, tax, total, status, provider reference. |
| `notifications` | user, type, payload, read_at. |
| `audit_events` | org (nullable), actor id/type, action, target type/id, result, ip, user_agent, sanitized metadata JSON, created_at. Append-only. |
| `content_access_grants` | super-admin break-glass grant: org, admin, justification, approved_by, scope, expires_at. |

Migration approach: V1 baselines the current tables exactly; V2+ add HarDisk tables feature by feature. I recommend a **new, empty database** `cloud_disk` instead of the existing `dummy_cricket` (no data migration, no destructive changes to that DB).

## 6. Authentication and authorization

- Keep the existing mechanism: BCrypt, short-lived JWT access token, rotating refresh token, `Authority` catalog + `RoleAuthorities`, per-user grants/revocations, `@PreAuthorize`.
- **Role split (smallest change):** reuse existing roles as organization roles and add one:
  `ROLE_OWNER` (new; billing, org settings, delete org), `ROLE_ADMIN` (members, drives, allocation), `ROLE_MANAGER` (manage drives they are drive-`MANAGER` of), `ROLE_EMPLOYEE` (member).
  `ROLE_SUPER_ADMIN` becomes **platform-only**: it receives new `PLATFORM_*` authorities, not tenant file authorities, and has no `organization_id`.
- New authority catalog entries, e.g. `ORG_READ`, `ORG_WRITE`, `MEMBER_MANAGE`, `DRIVE_MANAGE`, `BILLING_READ`, `BILLING_MANAGE`, `AUDIT_READ`, `PLATFORM_ORG_MANAGE`, `PLATFORM_PRICING_MANAGE`, `PLATFORM_AUDIT_READ`, `PLATFORM_USER_MANAGE`.
- **Tenant isolation:** `UserPrincipal` gains `organizationId`; every tenant repository method takes it; lookups by foreign IDs return **404**. Dedicated tests attempt cross-org access to every resource type.
- **Drive/file permissions:** evaluated server-side by `DrivePermissionEvaluator` = org role (OWNER/ADMIN implicit drive manager) ∪ drive membership ∪ node shares.
- **Tokens in browsers:** access token kept in memory; refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/api/v1/auth` (frontends are new, so this changes no consumer). The access JWT carries a session id; revoking a session takes effect immediately via a cached revocation check.
- **Super Admin:** same auth endpoints; `/api/v1/admin/**` requires `PLATFORM_*` authorities. Recommend TOTP MFA for super admins.
- Login throttling, audit of every success/failure, generic error messages.

## 7. Organization onboarding

1. `POST /api/v1/onboarding/registrations` — org name, owner name/email/password (hashed immediately), selected plan (capacity TB + interval). Response does not reveal whether the email exists.
2. Email with single-use token (SHA-256 stored, 24 h expiry). Resend endpoint, rate-limited.
3. `POST /api/v1/onboarding/verify` — creates organization (`PROVISIONING`), owner user (`ROLE_OWNER`), subscription (`PENDING_PAYMENT`), provisioning job — in one DB transaction.
4. Provisioning worker (idempotent, retried with backoff): create B2 bucket (deterministic name), apply encryption + CORS, record `storage_locations`, mark org `ACTIVE`.
5. Owner may sign in after verification; if the org is not `ACTIVE`, the frontend shows an onboarding-status page (provisioning progress, failure reason, **Retry** for owners, payment step). Once `ACTIVE` and paid, they land on This PC.

Failure states are persisted (`PROVISIONING_FAILED` + last error); retries are safe because each step checks existing state first.

## 8. Backblaze B2 integration

Facts checked against current Backblaze documentation:
- B2's S3-compatible API supports CreateBucket, PutBucketCors, PutBucketEncryption, multipart (create/upload part/complete/abort/list), and **presigned URLs (SigV4 only)**; Backblaze documents the AWS SDK for Java v2 with an endpoint override.
- **Default limit: 100 buckets per account**, raised on request via Backblaze support/sales.
- B2 buckets keep file versions; a delete without a version id only hides the file (still billed).

Strategy:
- **One private bucket per organization** (as recommended), bucket name `cd-{env}-{orgPublicId}`, SSE-B2 encryption, CORS allowing only our frontend origin(s) for `PUT`/`GET`. Drives are DB metadata with key prefix `d/{driveId}/o/{uuid}`; no bucket per drive or member.
- Because of the 100-bucket limit, `storage_locations` also allows a shared bucket with an `org/{orgId}/` prefix, so we are not blocked before the limit increase is granted. **Decision needed** (see §14).
- **Uploads:** browser → presigned URLs directly to B2 (no file bytes through our backend). Files ≤ 100 MB: single presigned PUT; larger: multipart with 100 MB parts (B2 recommended size), per-part presigned URLs, parallel parts, retry per part, resume via ListParts.
  1. `POST /uploads` reserves quota on the drive row (`SELECT … FOR UPDATE`), creates a `PENDING` node + upload session (idempotency key).
  2. Client uploads parts.
  3. `POST /uploads/{id}/complete` → backend completes multipart, `HeadObject` verifies size, stores version id, moves bytes from reserved → used, node `ACTIVE`.
  4. Expired/abandoned sessions: worker aborts multipart, deletes object, releases reservation.
- **Downloads:** `GET /files/{id}/download` returns a presigned GET URL (≈5 min TTL, `Content-Disposition` set), never a permanent URL.
- **Deletion:** trash is soft (still counts toward usage). Permanent delete marks `PURGING` and enqueues a `storage_operations` row; the worker deletes **by version id**, and only after B2 confirms are bytes subtracted from usage.
- **DB/B2 consistency:** never call B2 inside a DB transaction that could roll back; use reservation → external call → confirmation, plus the outbox. A nightly **reconciliation** job lists each bucket and reports/repairs drift (orphan objects, missing objects, usage totals).
- B2 key ID/application key only in backend env vars; never logged or returned. Live B2 tests are opt-in (`-Db2.it=true` with real credentials).

## 9. Virtual drives and storage accounting

Three separate quantities: **purchased** (subscription capacity), **allocated** (sum of drive allocations), **consumed** (actual object bytes + reserved in-flight uploads).

Invariants, enforced in services under a row lock on the organization (allocation changes) or the drive (uploads), and covered by tests:
- `Σ drive.allocated_bytes ≤ organization.purchased_bytes`
- `drive.used_bytes + drive.reserved_bytes ≤ drive.allocated_bytes`
- Reducing a drive allocation below its usage is rejected; reducing subscription capacity below total allocation is rejected (admin must reallocate first). Nothing is ever deleted implicitly.

Drive letters `C`–`Z`, unique per organization among non-archived drives. Deleting a drive: must be empty → hard delete; otherwise **archive** (read-only, hidden) and optional purge job with explicit confirmation.

## 10. Billing and pricing

- Capacity: integer TB from `min_tb` (1) to `max_tb` (250), both stored in `pricing_configs`, not hardcoded.
- Effective price = valid org override (now within `valid_from/valid_to`) else active global config. Calculated **only** on the backend:
  `subtotal = capacity_tb × price_per_tb × interval_multiplier`, `tax = round(subtotal × tax_rate_bps / 10000)`, `total = subtotal + tax` (integer minor units, HALF_UP).
- `POST /billing/quote` returns the breakdown; `POST /billing/subscriptions` recomputes (client amounts ignored) and stores a pricing snapshot on the subscription and invoice lines.
- `DevPaymentGateway` (dev/local only, clearly labelled) marks invoices paid; production payment provider deferred until agreed.
- Super Admin manages global pricing (new version rows, never in-place edits) and org overrides; every change is audited.

## 11. API contracts (summary)

All responses use the existing `ApiResponse` envelope. Lists use `page`, `size`, `sort` and return `{items, page, size, totalItems, totalPages}`.

| Area | Endpoints (`/api/v1`) |
|---|---|
| Auth | `POST auth/login`, `POST auth/refresh` (cookie), `POST auth/logout`, `GET auth/me`, `GET/DELETE auth/sessions[/{id}]`, `POST auth/password`, `POST auth/password-reset[/confirm]` |
| Onboarding | `POST onboarding/registrations`, `POST onboarding/registrations/resend`, `POST onboarding/verify`, `GET onboarding/status`, `POST onboarding/provisioning/retry` |
| Organization | `GET/PATCH organization`, `GET organization/storage` |
| Members | `GET members`, `POST invitations`, `GET/DELETE invitations/{id}`, `POST invitations/accept` (public, token), `PATCH members/{id}` (role/status), `DELETE members/{id}` |
| Drives | `GET/POST drives`, `GET/PATCH/DELETE drives/{id}`, `PUT drives/{id}/allocation`, `GET/PUT/DELETE drives/{id}/members[/{userId}]` |
| Files | `GET drives/{id}/children?parentId=`, `GET nodes/{id}`, `GET nodes/{id}/breadcrumbs`, `POST folders`, `PATCH nodes/{id}` (rename/move), `POST nodes/{id}/trash`, `POST nodes/{id}/restore`, `DELETE nodes/{id}` (permanent), `GET trash`, `GET search?q=` |
| Uploads/downloads | `POST uploads`, `GET uploads/{id}/parts` (presign), `POST uploads/{id}/complete`, `DELETE uploads/{id}`, `GET nodes/{id}/download` |
| Views | `GET/PUT/DELETE favorites[/{nodeId}]`, `GET recents`, `GET views/photos`, `GET views/documents` |
| Sharing | `POST nodes/{id}/shares` (internal), `GET shared-with-me`, `GET shared-by-me`, `POST nodes/{id}/links`, `DELETE links/{id}`, public `GET public/links/{token}`, `POST public/links/{token}/unlock`, `GET public/links/{token}/download` |
| Billing | `GET billing/pricing`, `POST billing/quote`, `GET/POST billing/subscriptions`, `GET billing/invoices` |
| Notifications | `GET notifications`, `POST notifications/{id}/read` |
| Audit (org) | `GET audit-events` |
| Super Admin | `GET admin/dashboard`, `GET admin/organizations`, `GET admin/organizations/{id}` (+members, storage, subscriptions, provisioning), `POST admin/organizations/{id}/suspend|reactivate|provisioning/retry`, `GET/POST admin/pricing`, `GET/POST/DELETE admin/organizations/{id}/pricing-overrides`, `GET admin/users`, `POST admin/users/{id}/disable|enable`, `GET admin/audit-events`, `GET admin/security-events`, `POST admin/content-access-grants` |

Exact DTOs are published through OpenAPI; both frontends generate TypeScript types from `/v3/api-docs` (`openapi-typescript`) so the contract has one source of truth.

## 12. Frontend plan (both apps)

Stack per `CLAUDE.md`: React + TypeScript + Vite + **Redux Toolkit**, with **RTK Query** for server state (it *is* Redux, so no competing state library), React Router, Vitest + React Testing Library, MSW (tests only), ESLint, `tsc --noEmit`. UI: **Fluent UI React v9** (open-source, accessible, Windows-native look) — no Microsoft logos or product names; HarDisk has its own name/icon. *(Alternative: hand-written CSS components — see decisions.)*

Shared structure (each app is independent; no shared package because the repo layout is fixed):

```
src/
  app/          store.ts, router.tsx, providers.tsx
  api/          baseApi.ts (auth header, refresh-on-401, envelope unwrapping), generated/ (OpenAPI types)
  features/<f>/ pages, components, <f>Api.ts (RTK Query endpoints), <f>Slice.ts when needed
  components/   reusable UI (DataTable, EmptyState, ErrorBanner, ConfirmDialog, ProgressBar…)
  layouts/
  lib/          formatBytes, dates, validation schemas
  test/         setup, MSW handlers, render helpers
```

**`cloud-disk-frontend` (users):** features `auth`, `onboarding` (register, verify, status/retry, plan selection), `explorer` (layout: top bar with breadcrumbs, search, upload, notifications, profile; collapsible sidebar with Quick access, Favorites, Recents, Photos, Documents, Shared with me, Shared by me, Trash; **This PC** drive cards with letter, name, allocated/used/free and blue usage bar; list/grid views, sort, keyboard navigation, context menus), `uploads` (queue, multipart, progress, retry, cancel), `sharing`, `trash`, `members`, `drives` (create, allocate, members), `billing` (slider 1–250 TB + numeric input, live server quote), `settings` (profile, organization, security, sessions), `notifications`.

**`cloud-disk-super-admin-frontend`:** features `auth` (requires platform role), `dashboard` (real aggregates), `organizations` (list/filter/paginate, detail tabs: members, storage, provisioning, subscriptions, overrides; suspend/reactivate/retry), `users`, `pricing`, `audit`, `security-events`, `content-access`.

Environment: `VITE_API_BASE_URL` only; no secrets in frontends. Dev servers on fixed ports (5173 user, 5174 admin) for CORS.

## 13. Testing, verification, deployment

- **Backend unit (JUnit 5 + Mockito):** capacity/allocation rules, pricing & tax math, override precedence, share expiry/revocation/password, permission evaluator, onboarding state machine, upload reservation/complete/expire, purge outbox, storage-failure handling (fault-injecting storage adapter).
- **Backend integration (`@SpringBootTest` + MockMvc):** auth flows, cross-organization access attempts on every resource, admin vs tenant separation, Flyway migrations. Docker is **not installed** on this machine, so Testcontainers is unavailable; tests run on H2 in MySQL mode, plus an optional profile against a local MySQL (`cloud_disk_test`) when credentials are provided.
- **Frontend:** Vitest + RTL + MSW for components/flows (drive cards, upload manager, quote form, auth refresh), `npm run lint`, `npm run typecheck`, `npm run build` for both apps.
- **Commands per milestone:** `./mvnw clean verify`, and in each frontend `npm ci && npm run lint && npm run typecheck && npm test && npm run build`.
- **Deployment (documented, not executed):** backend as a jar/container with env vars (DB, JWT, B2, SMTP, CORS origins), both frontends as static builds behind HTTPS; Flyway runs on startup. No production deployment without your approval.

## 14. Decisions needed from you

1. **B2 bucket strategy:** per-organization bucket (requires asking Backblaze to raise the 100-bucket limit) **or** a shared private bucket with per-org key prefixes, with per-org buckets later. *Recommendation: support both in `storage_locations`; default to per-org buckets and request the limit increase.*
2. **Database:** OK to use a new `cloud_disk` MySQL database (leaving `dummy_cricket` untouched) and to delete the unrelated `Leads`/`NearByLocation` code?
3. **Roles:** OK to reuse `ROLE_ADMIN/MANAGER/EMPLOYEE` as organization roles, add `ROLE_OWNER`, and make `ROLE_SUPER_ADMIN` platform-only? Should org Owner/Admin automatically see the **contents** of every drive? *(Recommendation: yes for Owner/Admin.)*
4. **One organization per user account?** *(Recommendation: yes; email stays globally unique as it is today.)*
5. **Email delivery:** which SMTP provider (or a transactional email service)? Until then a dev adapter writes emails to the log in `local` only.
6. **Pricing defaults:** initial price per TB, currency, billing intervals (monthly/annual + annual discount?), tax handling (a single configurable rate, or per-country rates?). TB = 10¹² bytes (decimal)?
7. **Activation gate:** must the first payment succeed before the org becomes usable, or is there a trial capacity?
8. **Share recipient restrictions:** restricted links require the recipient to sign in as a HarDisk user (recommended now), or do you also need email one-time codes for external recipients?
9. **Super Admin exceptional content access:** approved by the organization owner, or by a second super admin? Default grant duration?
10. **UI kit:** Fluent UI React v9 (recommended) or custom CSS components?
11. **Super Admin MFA (TOTP)** in this scope?
12. **Package name:** keep `com.empedance.dlp` (recommended) or rename to e.g. `com.empedance.clouddisk`?
13. **Version control:** the folder is not a git repository. May I run `git init` so milestones are reviewable?
14. **Secrets:** please rotate the MySQL password currently written in `application-local.properties`.

## 14a. Resolved decisions (approved 2026-10-28, "Approve defaults")

| # | Decision |
|---|---|
| 1 | `storage_locations` supports both strategies; default is a private bucket per organization. Request a B2 bucket-limit increase before ~90 organizations. |
| 2 | New MySQL database `cloud_disk`; `dummy_cricket` untouched. `Leads`/`NearByLocation` removed. |
| 3 | Existing roles reused as organization roles, `ROLE_OWNER` added, `ROLE_SUPER_ADMIN` platform-only. Owner/Admin can access contents of all drives in their organization. |
| 4 | One organization per user account; email globally unique. |
| 5 | Email: Empedance mail API (`POST https://empedance.com/api/send-mail`, `x-api-key` header), chosen 2026-10-29. Development-only log adapter remains the local/dev default. |
| 6 | TB = 10¹² bytes. **No prices are seeded**: quotes and subscriptions are refused until a Super Admin creates the first pricing configuration (prices are never hardcoded). Single configurable tax rate per pricing configuration. |
| 7 | An organization becomes usable after provisioning, with 0 purchased bytes; drives can be created only after a paid subscription (dev payment adapter locally). |
| 8 | Restricted share links require the recipient to sign in. External email OTP deferred. |
| 9 | Super Admin content access requires organization-owner approval; default grant 1 hour, read-only, audited. |
| 10 | Fluent UI React v9. |
| 11 | TOTP MFA for Super Admins, delivered in the hardening milestone. |
| 12 | Package name `com.empedance.dlp` kept. |
| 13 | Git initialised (branch `main`). |
| 14 | MySQL password removed from config; rotation is the owner's action. |

## 15. Milestone order after approval

1. **Foundation:** fix P1–P3, P6, P10–P11; Flyway baseline; env config; CORS; both Vite apps scaffolded (router, store, API client, theme, tests) and building.
2. Onboarding + authentication (P4, P5, P7, P8), sessions, audit skeleton.
3. Members & invitations.
4. Storage abstraction, B2 adapter, provisioning worker.
5. Drives & allocation.
6. Files/folders, uploads/downloads, trash, purge, reconciliation.
7. This PC explorer UI.
8. Favorites, Recents, Photos, Documents, search.
9. Permissions & sharing.
10. Subscription & billing.
11. Super Admin portal.
12. Audit/security hardening, docs, deployment guide, final verification.

Each milestone ends with: changed files, commands run, real test results, and remaining work.

## 16. Milestone log

### Milestone 1 — Foundation (2026-10-28)

**Backend (`coude-disk-bakend/`)**
- Secrets removed from all properties; `.env` support (`spring.config.import=optional:file:.env[.properties]`) + `.env.example`; `JWT_SECRET` mandatory, no bootstrap-admin defaults (P1).
- Flyway added (`spring-boot-starter-flyway`, `flyway-mysql`); `V1__baseline_auth_schema.sql`; `ddl-auto=validate` everywhere (P2). Enum element collections stored as VARCHAR (`@JdbcTypeCode`) so MySQL validation matches the migration.
- `prod` profile uses the MySQL driver; Swagger off in prod by default (P3).
- Disabled users rejected by the JWT filter, login (403) and refresh (403) (P6).
- `GlobalExceptionHandler`: 400 for malformed bodies/parameters, 404/405/415, 409 for optimistic-lock conflicts, unexpected errors logged (P10).
- springdoc 2.8.13 verified working on Boot 4.1 (OpenAPI test) — no upgrade needed (P11).
- CORS allow-list from `app.security.cors-allowed-origins` (P8, CORS part).
- Leftovers removed: `Leads`, `NearByLocation`, `LeadsRepo`, dead `permitAll` routes (P9).
- Tests: `AuthFlowIntegrationTest` (9 tests: login/refresh rotation and reuse rejection, wrong password, duplicate registration, validation and malformed JSON, unauthenticated access, employee forbidden from admin endpoints, disabled user, CORS allow/deny, OpenAPI served).

**Frontends** — both scaffolded from scratch: Vite 8, React 19, TypeScript 6 (strict), Redux Toolkit + RTK Query (envelope unwrapping, normalised `ApiError`, single-flight refresh-and-retry on 401), React Router 7, Fluent UI v9 with light/dark theme, ESLint, Vitest + Testing Library + MSW (tests only).
- User app: sign-in, route guard, Windows-style shell (top bar with breadcrumbs, search, upload, notifications, profile menu; collapsible sidebar with Quick access, Favorites, Recents, Photos, Documents, Shared with me/by me, This PC, Trash), `DriveCard` component, empty states (no fabricated data).
- Admin app: platform-role sign-in gate, console shell (Dashboard, Organizations, Users, Pricing, Audit logs, Security events).

**Verification run**
- `./mvnw clean verify` → 10 tests, 0 failures, jar built.
- User app: `npm run typecheck`, `npm run lint`, `npm test` (11 tests), `npm run build` → all pass (bundle-size warning: 802 kB; route-level code splitting planned).
- Admin app: same commands → all pass (6 tests).

**Not verified**
- Flyway/Hibernate validation against real MySQL 8 (no credentials available; verified on H2 MySQL mode only).
- Visual check in a browser (the in-app browser refused localhost).

**Known follow-ups carried into Milestone 2:** refresh token hashing, HttpOnly cookie and sessions (P7); login throttling (P8); replacing public `/auth/register` with onboarding (P4); role scoping (P5); generated OpenAPI types.

### Milestone 2 — Onboarding and authentication (2026-10-28)

**Backend**
- `V2__organizations_onboarding_sessions_audit.sql`: `organizations`, `organization_registrations`, `audit_events`; `app_users` gains organization, display name and lockout columns; `refresh_tokens.token` becomes `token_hash` with session metadata. Pre-existing plaintext refresh tokens are marked revoked by the migration.
- Onboarding: register → emailed token (24 h, single use, SHA-256 stored) → verify creates the organization (`PROVISIONING`) and its `ROLE_OWNER` user in one transaction. Existing-email registrations are indistinguishable from new ones; a new registration supersedes the earlier link.
- Auth: hashed refresh tokens, logout, session list and revoke, `/auth/me`, refresh-token reuse detection (revokes all sessions), per-account lockout with 429, audit trail for login success/failure/lockout/logout.
- P4 fixed: public `/auth/register` removed. P5 fixed: user management is scoped to the caller's organization and restricted role grants. P7 and P8 fixed except as listed below.
- Found and fixed: the class-level role check on `UserController` was silently overridden by method-level annotations, letting any `USER_READ` holder (e.g. `ROLE_MANAGER`) read any user.
- Bootstrap admin is now `ROLE_SUPER_ADMIN`.

**User frontend:** register page (client-side validation, check-your-email state with resend), verify page (single token consumption), sign-in link to register, organization status banner driven by `/auth/me`, server-side sign-out, 401 refresh now also covers `/auth/me`. **Admin frontend:** server-side sign-out and the same refresh fix.

**Verification run**
- `./mvnw clean verify` → 31 tests, 0 failures (auth flow 10, sessions/lockout 8, onboarding 8, tenant isolation 4, context 1).
- User app: typecheck, lint, 23 tests, build pass. Admin app: typecheck, lint, 7 tests, build pass.

**Not done / known limitations**
- Refresh token is still returned in the JSON body and kept in memory (lost on page reload). The HttpOnly-cookie design (plan §6) is deferred; it needs a same-site deployment or proxy decision.
- Access tokens remain valid for up to 15 minutes after logout or session revocation (no session id in the JWT yet).
- Lockout is per account only; per-IP throttling and registration rate limiting beyond the 1-minute resend cooldown are not implemented.
- Selected plan/capacity at registration is not collected; it belongs to the billing milestone.
- Organizations stay `PROVISIONING` until Milestone 4 adds the B2 provisioning worker; the UI shows this honestly.
- No real email provider; the development adapter logs messages. Not run against real MySQL. Generated OpenAPI TypeScript types are still not set up (types are hand-written).
- Password reset, change password and MFA are not yet implemented.

### Milestone 3 — Members and invitations (2026-10-29)

**Backend**
- Email: `EmpedanceEmailService` for the Empedance mail API (key from `MAIL_API_KEY`, optional body key `MAIL_API_BODY_KEY`, 10 s timeouts, HTML-escaped bodies, failures → 503 with rollback). `prod` defaults to it; `local`/`dev` default to the log adapter (`MAIL_PROVIDER=empedance` switches).
- `V3__members_and_invitations.sql`: `invitations`; `app_users.created_at`, `last_login_at`.
- Invitations (create, list, resend with cooldown, revoke, public preview and accept), member list with search/status/paging, role changes, activation/deactivation (revokes sessions), organization activity history from `audit_events`.
- Authorities `MEMBER_MANAGE`, `AUDIT_READ`; role hierarchy in `OrgRoles`.

**User frontend:** Team page (sidebar entry only for owners/admins) with Members (search, status filter, paging, role select limited to grantable roles, deactivate with confirmation, activate), Invitations (resend, revoke, expired badge), Activity; Invite dialog; public accept-invitation page.

**Verification run**
- `./mvnw clean verify` → 46 tests, 0 failures (new: members 10, mail adapter 5).
- User app: typecheck, lint, 38 tests, build pass. Admin app: 7 tests, build pass.

**Not verified / limitations**
- The real Empedance mail API was **not called** (it would send real email, and no real key was provided). The adapter is tested against a mocked HTTP server matching the supplied curl. Unknown: the API's success response and whether the body `apiKey` is required or differs from the header key.
- Drive assignment and drive-level permissions are deferred to Milestone 5 (drives do not exist yet).
- Ownership transfer is not implemented, so owners cannot be changed through the Team page.
- A member cannot be removed from the organization entirely; deactivation is the revocation mechanism (keeps audit history).
- Deactivation takes effect immediately for API calls, because the JWT filter reloads the user on every request. (Plain logout still leaves the access token usable for up to 15 minutes.)
- Still not run against MySQL or viewed in a browser.

### Milestone 4 — Storage and B2 provisioning (2026-10-29)

**Backend**
- New dependency: AWS SDK for Java v2 `s3` 2.55.16 (via BOM; Netty client excluded). Backblaze documents this SDK for its S3-compatible API.
- `ObjectStorageService` with B2, local-disk (dev only) and in-memory test adapters.
- `V4__storage_provisioning.sql`: `storage_locations`, `provisioning_jobs`; queues a job for every organization already waiting in `PROVISIONING`.
- Provisioning worker: multi-instance-safe claiming, idempotent steps, exponential backoff, permanent-failure detection, stale-lock takeover, audit events, sanitized error summaries. Verification now enqueues the job. Suspended organizations are not reactivated by provisioning.
- Endpoints: `GET /api/v1/organization/provisioning` (owner/admin), `POST /api/v1/organization/provisioning/retry` (owner).

**User frontend:** the status banner polls every 10 s while storage is being set up and disappears when the organization becomes `ACTIVE`; on failure owners see the reason and a **Retry setup** button, other members are told the owner can retry.

**Verification run**
- `./mvnw clean verify` → 65 tests: 64 passed, 1 skipped (`B2LiveTest`, needs real B2 credentials). New: provisioning integration 8, B2 adapter unit 6, provisioning unit 2, local adapter 2.
- User app: typecheck, lint, 41 tests, build pass. Admin app: 7 tests, build pass.

**Not verified / limitations**
- **No call has been made to real Backblaze B2.** The B2 adapter is tested with a mocked S3 client; behaviour of B2's S3 API for CreateBucket/PutBucketEncryption/PutBucketCors is taken from Backblaze's documentation. Run `B2LiveTest` with real credentials to confirm.
- B2 application keys that are restricted to a single bucket cannot create buckets; per-organization buckets need a key with `writeBuckets` (or the master key). Consider the `shared` strategy if that is not acceptable.
- The 100-bucket default limit is not enforced or monitored by the app; request an increase from Backblaze before ~90 organizations.
- Bucket deletion (organization offboarding) and storage reconciliation are not implemented yet (files milestone and later).
- Super Admin view/retry of provisioning comes with the Super Admin portal.

### Milestone 5 — Virtual drives (2026-10-29)

**Backend**
- `V5__drives.sql`: `drives` (unique active letter per organization, usage CHECK) and `drive_members`.
- Create (explicit or next free letter), rename, resize, archive, restore, delete-if-empty; drive membership with four permission levels; `GET /api/v1/organization/storage` (purchased / allocated / unallocated / used).
- Capacity is serialized by a pessimistic lock on the organization row; tested with 8 concurrent 200 GB creates against 1 TB (exactly 5 succeed, totals consistent).
- `DriveAccessService` centralizes drive authorization for this and later milestones.
- **Development-only capacity grant** (`POST /api/v1/dev/organization/capacity`, owner only, audited as `DEV_CAPACITY_GRANTED`): purchased capacity otherwise stays 0 until billing (Milestone 10), and drives could not be created. The endpoint is not registered in `prod`.

**User frontend:** This PC shows real drive cards (letter, name, allocated/used/free, blue usage bar) and, for owners/admins, organization storage totals; drive page with capacity and the caller's permission; Organization › Drives page: create (letter, name, size in GB bounded by unallocated storage), resize (bounded by usage and capacity), rename, archive/restore with confirmation, delete with confirmation, drive members dialog, development capacity card (owners, only when the backend reports it).

**Verification run**
- `./mvnw clean verify` → 75 tests: 74 passed, 1 skipped (`B2LiveTest`). New: drives integration 10.
- User app: typecheck, lint, 53 tests, build pass. Admin app: 7 tests, build pass.

**Not verified / limitations**
- Usage is always 0 until files exist (Milestone 6); "allocation below usage" and "drive not empty" are tested by setting usage directly in the database.
- Purging an archived drive's data is not implemented (needs files and storage deletion).
- `drives.letter` is declared `CHAR(1)`; Hibernate schema validation of that column has only been run on H2, not MySQL.
- A member's drive access is kept when they are deactivated (they cannot sign in); it is not removed automatically.

### Manual review run (2026-10-29, after Milestone 5)

First run of the real application outside tests: backend with the `dev` profile (file H2, local storage adapter), user frontend via `npm run dev`, driven over HTTP and in a browser.

**Worked end to end:** register → verification link in the `DEV EMAIL` log → verify → provisioning finished within seconds (organization `ACTIVE`, bucket folder created) → sign in → development capacity 2 TB → create C: 500 GB → oversized drive refused → This PC and Organization › Drives show the real values.

**Issues found** — all five fixed and re-checked in the browser on 2026-10-29 (see "Review fixes" below):
1. Any full page load (refresh, typed URL, bookmark) signs the user out — tokens live only in memory. Most visible problem; needs the HttpOnly refresh-cookie work (plan §6).
2. At phone width the sidebar stays expanded and the content is clipped and scrolls sideways. The sidebar should start collapsed below a breakpoint.
3. Plain router links (e.g. "Create an organization") use the browser's default blue, unreadable in dark mode. Use Fluent `Link` styling.
4. Capacity error messages show raw byte counts ("1500000000000 bytes"). Format as GB/TB.
5. Drives table has no loading indicator; the "Development only" notice is truncated on one line; drive row actions stack vertically (use an overflow menu).

### Review fixes (2026-10-29)

1. **Session survives reloads.** The refresh token is now only an `HttpOnly; SameSite=Strict; Path=/api/v1/auth` cookie (`cd_refresh`, `Secure` except plain-http local/dev) and no longer appears in any JSON response. Both apps restore the session on startup by calling `/auth/refresh` with the cookie; route guards wait for that answer. `V6__refresh_token_revoked_at.sql` records when a token was revoked: replaying it within 30 s is treated as two tabs refreshing at once (plain 401, and the client retries once), replaying it later still revokes every session. Non-browser clients may still send the token in the request body.
   *Deployment consequence:* the frontends and the API must be on the same site (e.g. `app.example.com` / `admin.example.com` / `api.example.com`). One browser holds one HarDisk session: signing in to the admin console replaces a user-app session in that browser, and the admin console ignores a restored non-platform session.
2. **Phones:** the sidebar starts as an icon rail below 768 px, opens as an overlay drawer and closes after navigating; breadcrumbs hide on narrow screens.
3. **Links:** `AppLink` renders router links with Fluent link styling (readable in both themes); "Go to sign in" is a button.
4. **Sizes in messages:** drive capacity errors and drive audit details use `ByteSizes.format` ("1.5 TB").
5. **Drives page:** loading spinner, wrapping "Development only" notice, per-row "…" actions menu.

Verification: backend `./mvnw clean verify` → 79 tests, 78 passed, 1 skipped (`B2LiveTest`); new tests cover the cookie attributes, cookie refresh/rotation, logout clearing the cookie, the 30 s race window and later reuse. User app: typecheck, lint, 57 tests, build pass (new: reload restore, race retry, mobile drawer, link styling). Admin app: typecheck, lint, 9 tests, build pass (new: platform restore, ignoring an organization session). Browser re-check against the running backend: reload on `/manage/drives` stays signed in, phone layout, link colour, readable error, drives page.

### Milestone 6 — Files and folders (2026-10-29)

**Backend**
- `V7__files_uploads_storage_operations.sql`: `file_nodes`, `upload_sessions`, `storage_operations`.
- Storage API extended (presigned PUT/GET, multipart create/part/complete/abort, HEAD, versioned delete) for B2 (AWS SDK presigner; presigning is offline signing), the local dev adapter (HMAC-signed URLs served by the API) and the test fake.
- Upload lifecycle with drive-level quota reservation, size verification, idempotent init and complete, cancel, 24 h expiry; folders; listing (folders first, sort by name/modified/size/type); breadcrumbs; rename; move within a drive (cycle, depth and path-length checks); trash/restore/permanent delete/empty trash; trash listing across drives; 5-minute download URLs with `Content-Disposition: attachment`.
- Storage outbox worker + scheduler; usage is released only after the provider confirms deletion.
- Audit: FOLDER_CREATED, FILE_UPLOADED, FILE_DOWNLOADED, ITEM_RENAMED/MOVED/TRASHED/RESTORED/DELETED, TRASH_EMPTIED, UPLOAD_CANCELLED, STORAGE_OPERATION_FAILED (no URLs or keys).
- Found and fixed during the run: Spring's form filter consumed raw PUT bodies with a form content type (dev storage), and `/error` required authentication, turning real errors into 401.

**User frontend:** drive file browser (`/drives/:id`, `/drives/:id/folders/:folderId`) with breadcrumbs, New folder, Upload files, per-row Download/Rename/Move to…/Move to trash by permission; upload engine (direct PUT to storage with progress, multipart with 3 parallel parts and per-part retry, ETag collection, idempotent init, cancel, retry); upload panel; top-bar Upload targets the open folder; Trash page with restore and permanent delete. `formatBytes` no longer prints “2.0 KB”.

**Verification run**
- `./mvnw clean verify` → 104 tests: 103 passed, 1 skipped (`B2LiveTest`). New: files integration 19, B2 adapter +4, local adapter +2.
- User app: typecheck, lint, 71 tests (three consecutive green runs), build. Admin app: 9 tests, build.
- Real run (dev profile, local storage adapter): single upload, wrong Content-Type rejected (403), download byte-identical with attachment header; 12 MB multipart via HTTP byte-identical; purge removed the object and released usage. In the browser: 7 MB multipart + small single upload from the page (CORS preflight and ETag exposure work), list refresh, trash, Trash page.

**Not verified / limitations**
- Not run against real Backblaze B2: presigned URLs are tested by signing offline and by the local adapter. B2's behaviour for `DeleteObject` with a non-existent version id is assumed to succeed.
- Moving between drives is not supported yet (needs server-side copy). Folder sizes are not computed. Trash is not auto-emptied after a retention period.
- Storage reconciliation (listing buckets to find orphans or drift) is not implemented; planned for hardening.
- `organizations.used_bytes` is unused (organization usage is the sum of drive usage).
- Explorer polish is Milestone 7: grid view, sortable columns, search, keyboard navigation, drag-and-drop upload, multi-select, top-bar breadcrumb title on drive pages, Trash row actions as a menu.

### Milestone 7 — Windows-style explorer (2026-10-29)

**Backend:** `GET /api/v1/search` (name search across accessible drives with locations; literal wildcards; access-scoped). +2 integration tests.

**User frontend**
- Address bar in the top bar: This PC › Drive (C:) › Folder … with clickable segments; search box submits to a Search results page (folder path per result; opening a file shows it selected in its folder via `?select=`).
- Explorer: Details view with sortable column headers (`aria-sort`) and checkboxes, Tiles view; view choice remembered per browser (localStorage, safe fallback).
- Selection: click, Ctrl/Cmd+click, Shift+click ranges, select-all checkbox; selection bar with bulk Download, Move to…, Move to trash.
- Keyboard: arrows (Shift extends; first press selects the first item), Enter opens, F2 renames, Delete trashes, Ctrl/Cmd+A, Escape; focus outline only after keyboard use.
- Right-click context menu at the pointer (same commands as the row menu), Properties dialog (type, location, size in bytes, created, modified), drag-and-drop upload with drop overlay, multi-item move, folder name as page heading, Trash row actions as a menu.

**Test infrastructure:** Vitest limited to 3 workers with a 15 s test and 5 s query timeout. Measured: with 8 workers jsdom+Fluent tests starved each other and failed intermittently; with 3 the suite is stable (11 s, same as before). A chained archive/restore/delete test was split in two because back-to-back menu actions during list refetches raced under load.

**Verification run**
- `./mvnw clean verify` → 106 tests: 105 passed, 1 skipped (`B2LiveTest`).
- User app: typecheck, lint, 82 tests (green on 9 consecutive full runs after the worker fix), build. Admin app: 9 tests, build.
- Browser against the running backend: address bar, sortable details view, tiles, right-click menu, selection bar, top-bar search, opening a result selects it in its folder, heading and focus fixes.

**Fixed during this milestone:** `AddressBar` concatenated Fluent classes instead of `mergeClasses`; the first arrow key skipped the first item; focus outline showed on page load.

**Not done / limitations**
- Bulk download starts one browser download per file (no zip); browsers may ask to allow multiple downloads.
- No drag-and-drop moving between folders, no folder sizes, no inline thumbnails.
- Search matches names only (no content search) and has no relevance ranking (folders first, then name).

### Milestones 8–9 — Library views and sharing (2026-10-29)

**Backend:** `V8__library_and_sharing.sql` (favorites, recent_items, node_shares, share_links, share_link_recipients; cascade with file nodes). Favorites, recents, photos/documents views; people shares (read-only subtree access) with shared-folder browsing and download; share links with server-enforced expiry, revocation, password lockout and recipient restriction; Shared with me / by me; `GET /api/v1/people`.
**Frontend:** Favorites, Recents, Photos, Documents pages; “Add to Favorites” and “Share…” in item menus; share dialog (people, links with expiry/custom date/password/recipients, copy URL once, revoke); Shared with me (with shared-folder browsing), Shared by me (revoke); public link page `/s/:token` (password prompt, sign-in prompt, folder browsing, downloads).
**Verification:** `./mvnw clean verify` → 111 tests, 110 passed, 1 skipped (`B2LiveTest`); new: library 1, sharing 4 (+ people directory assertion). User app: typecheck, lint, 88 tests (3 consecutive green runs), build. Not run in a browser this milestone.
**Limitations:** people shares are view/download only (editing still requires drive membership); restricted links need recipients who have HarDisk accounts (no email one-time codes); no notifications or emails are sent when sharing; links count downloads, not views.

### Milestone 10 — Subscription and billing (2026-10-29)

**Backend:** `V9__billing.sql` (pricing_configs, organization_pricing_overrides, subscriptions, invoices, invoice_lines). Global price is per TB per month; `ANNUAL` bills 12 months. Effective price = override valid now (newest `valid_from` wins) else newest active global config with `effective_from ≤ now`; overrides change only the unit price (currency, tax, 1–250 TB limits come from the global config). `PricingCalculator`: integer minor units, tax HALF_UP, overflow-checked. `POST /billing/quote`, `POST|GET /billing/subscriptions`, `GET /billing/invoices` (owner + `BILLING_MANAGE`); purchase locks the organization row, recomputes, refuses capacity below allocation (409), supersedes the active subscription, writes a paid invoice with a pricing snapshot and sets `purchased_bytes`. `PaymentGateway` with `DevPaymentGateway` (`app.payment.provider=dev`, local/dev/test only); `none` (default, prod) refuses purchases with 503. The dev capacity grant is refused (409) and hidden while a subscription is active. Super Admin stubs: `POST|GET /admin/pricing`, `POST|GET /admin/organizations/{id}/pricing-overrides` (`ROLE_SUPER_ADMIN` + platform-only `PRICING_MANAGE`), audited.
**Frontend:** Organization › Billing (owners only; nav item hidden for others): 1–250 TB slider + numeric input, debounced live server quote (price/TB, interval, subtotal, tax, total), below-allocation guard, confirm dialog, current subscription, invoice history, dev-adapter warning.
**Verification:** `./mvnw clean verify` → 119 tests, 118 passed, 1 skipped (`B2LiveTest`); new: `PricingCalculatorTest` 3, `BillingIntegrationTest` 5. User app: typecheck, lint, 92 tests (4 new), build. Not run in a browser this milestone.
**Limitations:** no real payment provider; changing capacity starts a new full period (no proration, no credit for the old one); no renewal/expiry job (periods are recorded only); invoices are not emailed or downloadable as PDF; the payment call runs inside the purchase transaction (acceptable only for the in-process dev adapter).

### Milestone 11 — Super Admin portal (2026-10-29)

**Backend:** `AdminController` + `PlatformAdminService`: `GET admin/dashboard` (live counts by status, users, capacity totals, active subscriptions, paid revenue per currency, failed sign-ins in 24 h, newest organizations); `GET admin/organizations` (search, status, paging), `GET admin/organizations/{id}` (owners, members, drives, provisioning, subscription), `POST …/suspend|reactivate` (reason required, audited), `POST …/provisioning/retry`, `GET …/subscriptions|invoices`; `GET admin/users` (search, organization, platform-only), `POST admin/users/{id}/disable|enable` (reason required; disabling revokes sessions; platform staff refused); `GET admin/audit-events`, `GET admin/security-events`; `DELETE admin/organizations/{id}/pricing-overrides/{oid}` ends an override (kept for history). New platform-only authorities `PLATFORM_ORG_MANAGE`, `PLATFORM_USER_MANAGE`, `PLATFORM_AUDIT_READ`. No schema change.
**Frontend (`cloud-disk-super-admin-frontend`):** Dashboard, Organizations (search/status filter/paging), organization detail (overview, storage setup + retry, subscription + invoices, negotiated price add/end, members with disable/enable, suspend/reactivate with reason dialog), Users, Pricing (publish version: decimal price → minor units, % → bps; version history), Audit logs and Security events (filters, paging).
**Verification:** `./mvnw clean verify` → 124 tests, 123 passed, 1 skipped (`B2LiveTest`); new: `PlatformAdminIntegrationTest` 5. Admin app: typecheck, lint, 15 tests (6 new), build. Not run in a browser this milestone. (One earlier run stalled ~16 min inside `FilesIntegrationTest` and failed with expired tokens; the clean re-run passed — most likely the machine slept.)
**Deferred to Milestone 12:** content-access grants (owner-approved break-glass, decision 9 — until then Super Admins have no file-content access at all), TOTP MFA for Super Admins, organization creation from the console (organizations still self-register).

### Milestone 12 — Hardening, deployment guide, final verification (2026-10-29)

**Backend:** `V10__mfa_and_content_access.sql`. Super Admin TOTP MFA (RFC 6238): password → hashed single-use challenge (5 min, 5 attempts) → `POST auth/mfa/verify`; enrollment on first sign-in shows the secret once and stores it AES-GCM encrypted only after a valid code; replayed codes refused; wrong codes count toward lockout; refresh cookie only after the second factor. Owner-approved content-access grants (decision 9): Super Admin requests with justification and 15–240 min, owner approves/denies/revokes in the user app, access is read-only (list, breadcrumbs, download) through a delegated VIEWER principal for one organization, expires automatically, writes no recents, and every browse/download/refusal is audited. Per-IP rate limiting on public POST endpoints (429 + `Retry-After`, audited once per window). API security headers (CSP `default-src 'none'`, frame/nosniff/no-referrer, HSTS on HTTPS). Security events include MFA, rate-limit and refused-access events; failed-login dashboard count includes MFA failures. `prod` trusts forwarded headers.
**Frontends:** Super Admin console: two-step sign-in with authenticator enrollment, Content access page (requests, status, end now) and read-only grant browser with downloads, request card on organization detail. User app: owner-only “Access requests” page (approve/deny/revoke), and platform accounts are told to use the console.
**Docs:** `docs/deployment.md` (components, build, environment, TLS/headers, first-start checklist, operations, known gaps).
**Verification:** `./mvnw clean verify` → 132 tests, 131 passed, 1 skipped (`B2LiveTest`); new: `SecurityHardeningIntegrationTest` 4, `TotpTest` 3, `RateLimitFilterTest` 1. User app: typecheck, lint, 95 tests (3 new), build. Admin app: typecheck, lint, 17 tests (2 new), build. Not run in a browser and not deployed.
**Remaining gaps (see deployment guide §7):** no real payment provider; MFA has no recovery codes (lost device needs a database reset by staff); rate limits are per instance; restricted links require accounts.

### Change after Milestone 12 — Email one-time codes for Super Admins (2026-10-29)

At the owner's request the Super Admin second factor is now a 6-digit code emailed at each sign-in instead of an authenticator app. `V11__email_otp.sql` adds `mfa_challenges.code_hash` (additive; the V10 TOTP columns remain unused). TOTP code, `MfaCrypto` and `MFA_ENCRYPTION_KEY` removed. Codes: random, hashed with the challenge token, single use, 10 minutes, 5 attempts, failures count toward lockout. Console shows "We emailed a 6-digit code to a***@…". **Verification:** `./mvnw clean verify` → 129 tests, 128 passed, 1 skipped (`B2LiveTest`; the 3 TOTP unit tests were removed). User app: typecheck, lint, 95 tests, build. Admin app: typecheck, lint, 17 tests, build.

### Change — Billing size guard and Cloud Replication (2026-10-30)

Billing slider: dragging or typing a capacity whose drive share is below the stored files snaps back and shows "You have existing files of a total of X, so you can't reduce the storage. Please contact support." Cloud Replication (`V12__cloud_replication.sql`): owner-only page that keeps a second copy of every file in a replica bucket using a B2 Cloud Replication rule (native API); while on, half of the purchased capacity is reserved for the replica. Not yet run against a real B2 account.
**Verification:** `./mvnw clean verify` → 132 tests, 131 passed, 1 skipped (`B2LiveTest`); new `ReplicationIntegrationTest` 3. User app: typecheck, lint, build, 101 tests (6 new) green with one worker; with 3 workers some dialog tests failed intermittently while the machine was under heavy unrelated load (Spotlight indexing, load average 20).

### Change — Typed confirmation and pay-for-what-you-use billing (2026-10-30)

Capacity changes need the typed word "increase" or "decrease" (checked in the dialog and on the server) and take effect at once without charging. Bills are prorated by capacity segment (e.g. 15 days at 50 TB + 15 days at 40 TB), issued 5 days before the period ends and due at its end; daily countdown emails before the due date, daily "days until access is blocked" emails for 15 days after it, then members are blocked (owner can still sign in to pay). HTML billing emails; in-app payment banner; Pay now on invoices. `V13__metered_billing.sql` migrates existing subscriptions to segments.
**Verification:** `./mvnw clean verify` → 137 tests, 136 passed, 1 skipped (`B2LiveTest`). User app: typecheck, lint, build, 104 tests (parallel and single-worker runs both green). Not run in a browser.
**Limitations:** changes in the last 5 days are corrected on the next bill; no real payment provider (with `PAYMENT_PROVIDER=none` nobody can pay, so organizations would be blocked 15 days after their first due date — integrate a provider before production); the in-memory scheduler runs on every instance (idempotent, but each instance sends at most one reminder per invoice per day only because the reminder date is written in the same transaction; simultaneous runs could still both send).

### Change — Razorpay payments (2026-10-30)

Owners pay bills with Razorpay Checkout from the Billing page; the server creates (or reuses) one order per bill, verifies the checkout signature and the payment with Razorpay, captures authorized payments, and marks the bill paid exactly once. A signed webhook, an on-demand re-check (run automatically after a page refresh) and a 5-minute reconciliation job make sure a completed payment is never lost; money captured for an already-paid bill is refunded automatically. Super Admin console: Payments page with filters and "Check with Razorpay". `V14__payments.sql`.
**Verification:** `./mvnw clean verify` → 143 tests, 142 passed, 1 skipped (`B2LiveTest`); new: `RazorpayPaymentIntegrationTest` 4 (checkout reuse, confirmation, forged signature, webhook-only, refresh re-check with capture, reconciliation, failed and wrong-amount payments, duplicate refund, owner/admin access), `RazorpayHttpApiTest` 2. User app: 106 tests; admin app: 18 tests; typecheck, lint and build green for both. Not run against real Razorpay keys or in a browser.

### Change — Table layout, rupees and GST (2026-11-03)

Tables in both apps size columns by content and wrap long values inside their own cell (Fluent's fixed layout let emails and ids run over the next column); tables without one got a horizontal scroll wrapper. Checked visually in a browser. Pricing defaults to INR with 18% GST, shown as "GST" in quotes, bills and emails, with ₹ and Indian digit grouping. Existing plans move to the new currency at their next period, or immediately on a size change with a final bill in the old currency.
**Verification:** `./mvnw clean verify` → 145 tests, 144 passed, 1 skipped (`B2LiveTest`); new: currency switch (both paths), INR formatting, GST label. User app: typecheck, lint, build; 106 tests green one at a time, while parallel runs still hit the older intermittent dialog-test failures under machine load. Admin app: 18 tests, typecheck, lint, build.

### Change — PDF invoices (2026-11-05)

Owners download any bill as a PDF from the Billing page ("PDF" button next to each invoice); Super Admins download from an organization's detail page. A4 layout: reserved logo box top-left (dashed "Your logo" placeholder until `INVOICE_LOGO_PATH` points to a PNG/JPEG), "HarDisk" as issuer with optional address, GSTIN and email (`INVOICE_SELLER_*`), invoice number, issue and due dates, Paid/Unpaid, billed-to organization and owner email, billing period, lines, subtotal, GST, total, and payment method and Razorpay reference. Titled "Tax invoice" only when GST is charged and a GSTIN is set. Rupees print as "INR 1,18,000.00" (the built-in PDF fonts have no ₹ glyph). OpenPDF 2.0.3 added. Endpoints: `GET /api/v1/billing/invoices/{id}/pdf`, `GET /api/v1/admin/organizations/{orgId}/invoices/{id}/pdf`.
**Verification:** `./mvnw clean verify` → 148 tests, 147 passed, 1 skipped (`B2LiveTest`); new: `ownersDownloadTheBillAsAPdfInvoice` (content, unpaid→paid, owner-only, tenant scope, Super Admin) and `InvoicePdfTest` 2 (logo and GSTIN, placeholder fallback, crore amounts on one line). User app: typecheck, lint, build, 107 tests; admin app: typecheck, lint, build, 19 tests. A sample PDF was rendered and checked visually; the buttons were not clicked in a browser.

### Change — Payment receipt emails and the sign-in-free invoice page (2026-11-05)

When a bill is paid by any path, every owner gets a "Payment received" email after the payment commits: bill summary, method and Razorpay reference, and a "View and download invoice" button. No attachment (per the owner's request). The button opens `/invoices/{id}` in the user app, which works without signing in: it shows the invoice (logo space, issuer, number, Paid/Unpaid, billed to, period, lines, GST, total, payment) and a Download PDF button. The link is signed for that one invoice and expires after 30 days; the page's API calls (`GET /api/v1/public/invoices/{id}` and `/pdf`) check the signature. Sent once per bill; mail failures never affect the payment.
**Verification:** `./mvnw clean verify` → 149 tests, 148 passed, 1 skipped (`B2LiveTest`); new: receipt email links to the page (owners only), page data and PDF readable with the link while signed out, edited/other-invoice/expired links refused, one receipt despite confirm + webhook + repeat confirm (Razorpay). User app: typecheck, lint, build, 109 tests (page renders the invoice and PDF link; expired link explained). Checked in a browser signed out with the real local ₹1 invoice, at desktop and phone width; Download PDF returned the PDF. No email was sent through the real mail API.

### Change — Editors step D1: inline content, versions and edit sessions (2026-11-06)

First build step of the Docs editor (scope approved 2026-11-06, `docs/editor-docs-feature-set.md`; research in `docs/document-editors-research.md`). Backend only; no editor UI yet.
- `GET /api/v1/files/{id}/content`: 5-minute inline URL (types a browser would run, such as HTML and SVG, are served as plain text), the current version number and `canEdit`. Audited as `FILE_OPENED`.
- Edit sessions: `POST|PUT|DELETE|GET /api/v1/files/{id}/edit-session`. One editor per file; a 2-minute lease kept alive by heartbeats (`X-Lock-Token`); EDITOR or above; a reload of the same tab takes its own session back; another tab needs `takeOver`.
- Saves: `POST /api/v1/files/{id}/versions` (lock token and `baseVersionNo`) reserves space and returns a presigned PUT; the existing `POST /uploads/{id}/complete` adds the version, or returns 409 and discards it if a newer version exists. One person's saves within 10 minutes replace each other.
- History: `GET .../versions`; `GET .../versions/{vid}/content`; `POST .../versions/{vid}/restore` copies the old object into a new version.
- Storage accounting: every version counts toward drive usage until it is dropped (more than `EDITOR_MAX_VERSIONS`, default 100, or coalesced). Dropped and purged versions release their bytes only after storage confirms the delete. Permanent delete removes all versions.
- `V15__file_versions_and_edit_sessions.sql` backfills version 1 for existing files. New storage operations: `presignInline`, `copyObject` (B2, local, test fake). `AI_PROVIDER=none` and a `GROQ_API_KEY` placeholder are in `.env.example`, and empty in `.env`; nothing reads them yet.
**Verification:** `./mvnw clean verify` → 157 tests, 156 passed, 1 skipped (`B2LiveTest`). New: `EditorIntegrationTest` 7 (inline content and edit rights, safe inline types, one editor at a time with reload and takeover, saves with coalescing and storage accounting, stale saves refused with the reservation released, restore, permanent delete of all versions) and a local-storage copy/inline test. The migration ran only on H2 in the tests, not yet on MySQL.
**Limitations:** editor saves are a single PUT of up to 100 MB; shared-with-me users stay read-only (shares have no edit role yet); the B2 `copyObject` and inline presign are not tested against real B2.

### Change — Editors step D2: editor shell, preview and the open-file page (2026-11-06)

Clicking a file in the explorer (double-click, Enter, or Open in the item menu) opens it full-window at `/open/:fileId` instead of downloading it. Download stays in the item menu and the editor's top bar.
- Editor packages are an npm workspace in `cloud-disk-frontend/editors/`, so they share one React and Fluent UI. The approved plan had them in a top-level `cloud-disk-editors/`, which would have installed React and Fluent twice.
- `@cloud-disk/editor-core`:
  - The `EditorModule` contract (accepts edit, view or nothing; loaded on demand) and the `EditorBackend` interface, so editor packages do not depend on the portal's store.
  - `EditorShell`: back, rename from the title, save status, Ctrl/Cmd+S, and a warning before leaving with unsaved changes.
  - One editor at a time: a lease with heartbeats, released on close. Other people see "X is editing" and a read-only view; your own other tab gets "Edit here instead".
  - Autosave as new versions, 3 s after the last change. On a conflict or a lost session it stops, offers "Download my changes" and Reload, and switches to read-only.
  - Version history: a side panel, or an overlay on phones, with Open and Restore.
- `@cloud-disk/editor-preview` is the read-only fallback: images, video and audio from the inline URL, PDF in the browser's viewer, and text, code and SVG up to 2 MB as plain text. Other types show a download prompt.
- Portal side: `src/features/editors/` (route, module list, EditorBackend on top of RTK Query; the session is released with a keepalive request when the page closes).
- New → Document moved to D4, because creating a blank .docx needs the .docx writer.

**Verification:**
- User app: lint, typecheck, build, and 124 tests (new: save controller 4, shell 7, editor choice, preview types 2, and opening a file from the explorer and going back).
- Checked in a browser against this branch's backend on port 8081 with its own MySQL database (`cloud_disk_editor_test`; V15 migrated cleanly on MySQL): opened Markdown and PNG files from the explorer, viewed and restored versions, and checked the history panel at phone width. Two defects were found and fixed during the check: history did not refresh after a restore, and the history panel squeezed the page on phones.
- An editor save via the API on MySQL created version 2.
- Editing in the browser is covered only by unit tests until the Docs editor exists (no editing module yet).

**Limitations:**
- Files shared with you directly (not through a drive) still download, because the content endpoint requires drive access.
- Media URLs expire after 5 minutes, so seeking in a long video after that can fail until the page is reopened.

### Change — Editors step D3: the Docs editor (2026-11-06)

Opening a `.docx` now opens it in the new `@cloud-disk/editor-docs` package. It is built on Tiptap 3.32 (MIT) and loaded only when a document opens: a separate 321 KB gzipped chunk.
- **Editing:**
  - Text: paragraph styles (Normal, Heading 1–6); font, size, bold, italic, underline, strikethrough, superscript, subscript; text and highlight colour; links; alignment; line spacing; indent.
  - Lists and tables: bulleted, numbered and check lists; tables with insert/delete rows and columns, merge/split, header row and column resizing.
  - Inserts: images (stored inside the file, up to 10 MB), horizontal line, page break (Ctrl/Cmd+Enter), special characters.
  - Tools: find and replace (case, whole words, regex; Ctrl/Cmd+F); outline; page setup (A4/Letter/Legal, orientation, margins); page view with zoom (starts zoomed to fit narrow windows); word and character count; print; paste cleaning for Word and Google Docs.
- **Saving:** writes a regular .docx with `docx` 9.13 (MIT): headings, run formatting, numbering, tables with merged cells, images, page size and margins. The editor's own JSON travels inside the file (`cloud-disk/editor.json`, linked by a custom root relationship), so HarDisk documents reopen exactly as saved. A hash of `word/document.xml` detects edits made in other apps; such files are read through mammoth 1.13 (BSD-2).
- **Files from Word:** a notice says that fonts, colours and alignment set in Word are not shown yet. It also names the file's features that will be simplified (tracked changes, comments, footnotes, text boxes, charts, SmartArt, fields, content controls, headers and footers, …). The original stays in version history.
- **Backend fix:** `X-Lock-Token` added to the CORS allowed headers. Without it, browsers could not send heartbeats or release the edit session. The browser check found this; MockMvc tests do not apply CORS, so a preflight test was added.
- `src/test/setup.ts` now also runs for node-environment tests, which the file conversion tests use.

**Verification:**
- User app: lint, typecheck, build, and 140 tests. New: .docx export/import 6 (package and relationship, exact reopen, reading after an outside edit, simplified-feature detection, empty file, unit conversion); extensions 5 (find/replace options, navigation, replace one/all, indent and line spacing, page break, paste cleaning); editor 5 (module choice, open without a spurious change, edit and serialise, read-only, Word notice, Ctrl+F).
- Backend: `./mvnw clean verify` → 158 tests, 157 passed, 1 skipped (`B2LiveTest`).
- Checked in a browser against this branch on port 8081 (separate MySQL database):
  - a Word-style .docx (heading styles, bold/italic, colour, table, a tracked insertion) opened with the right notice
  - typing and Ctrl/Cmd+B autosaved ("Unsaved changes" → "All changes saved")
  - after a reload it reopened exactly, without the notice
  - a second tab opened read-only with "Edit here instead"; after taking over, the first tab showed "Editing stopped" on its next heartbeat
  - outline and find highlighting worked
  - at phone width the page starts zoomed to fit
- Not checked: files saved here have not been opened in Microsoft Word or LibreOffice (neither is installed on this machine).

**Limitations:**
- Pages are one continuous sheet with page-break markers; true pagination comes later.
- Fonts are not self-hosted yet: Calibri and others fall back to installed fonts.
- Comments and suggesting mode are planned for v1.1.
- Headers, footers and footnotes from Word are dropped on save; the notice says so.
- On phones the toolbar wraps onto four rows.

### Change — Editors step D4: Word reader, New document and exports (2026-11-07)

- **New → Document** button in every folder you can upload to: creates a blank "Untitled document.docx" (the next free name, "(2)", "(3)"…) through the normal upload API (so quota, permissions, versions and audit apply) and opens it.
- **Own Word reader** (`readDocx`, replaces mammoth for normal files; mammoth stays as the fallback if the XML cannot be read):
  - Block formatting: heading, title and based-on styles; alignment, line spacing and indent; list styles.
  - Lists: bulleted and numbered lists with nesting from `numbering.xml`.
  - Character formatting: bold, italic, underline, strikethrough, colour, size, font, highlight and shading, super/subscript, including formatting that comes from character and paragraph styles.
  - Links and images: external hyperlinks (only http, https and mailto), and inline images with size and description.
  - Tables: column spans and vertical merges.
  - Page breaks, tracked insertions (kept) and deletions (dropped).
  - A damaged styles, numbering or relationships part is ignored instead of failing the whole file.
  - Images in formats browsers cannot show (EMF and similar) are listed in the "will be simplified" notice.
- **Exports** in a new "Download as" toolbar menu: Markdown (.md; escapes, nested lists, check lists, GFM tables; images become `[image: description]`), plain text (.txt), and PDF through the browser's print dialog ("Save as PDF"). Printing shows only the page, uses the page setup for paper size and margins, and honours page breaks.
- **Phones:** the toolbar is one row that scrolls sideways instead of four wrapped rows.
- `test/fixtures/` is a drop-in folder for real .docx files; `corpus.test.ts` checks that each opens and keeps its text through a save and reopen.

**Verification:**
- User app: lint, typecheck, build, and 159 tests on one worker (new: reader on Word markup 11 plus the round-trip check that a re-read file saves to identical XML; Markdown and text 5; New document 2).
- A full parallel run showed two failures in unrelated drives and replication dialog tests, the known intermittent load failures; both pass on their own and on one worker.
- Checked in a browser on this branch (port 8081, separate MySQL database): a Word-style file with a centred heading, colours, Georgia, highlight, link, nested lists, a table and an indent opened as expected; New document created and opened a blank document and typing autosaved; the Markdown download matched the document; the toolbar fits a phone. The backend was not changed in this step.
- **Not verified:** the print preview and "Save as PDF" output (the browser pane cannot show the print dialog), and files from real Microsoft Word, Google Docs or LibreOffice (none on this machine).

**Limitations:**
- Pages are still one continuous sheet with page-break markers; true pagination is later.
- Headers, footers, footnotes, comments, text boxes and charts from Word are still dropped on save; the notice names them.
- Cell shading, column widths, tab stops and theme fonts or colours from Word are not read yet.

### Change — Editors step D5: AI features (2026-11-07)

AI for the Docs editor through a provider-agnostic layer. Groq is the first provider; nothing in the features or prompts mentions it. **Not run against real Groq** (no key was available): the provider is tested against a local server that speaks the same streaming protocol, and the whole path (browser, backend, provider) was run in a browser against that local server.
- **Provider layer** (`com.empedance.dlp.ai`):
  - `AiProvider` interface (`stream` with a delta callback, cancellation, token usage).
  - `OpenAiCompatibleProvider` covers Groq and any OpenAI-compatible service: it sends the key, streams the answer, reads usage, retries throttling and server errors up to twice, and gives safe error messages that never include the provider's reply or the key.
  - `NoopAiProvider` when `AI_PROVIDER=none` (the default).
- **Features**: `docs.write`, `docs.rewrite` (improve, shorter, longer, simplify, four tones, custom), `docs.proofread`, `docs.translate` (20 languages), `docs.continue`, `docs.summarize`, `docs.ask`. Prompts are versioned files in `resources/ai/prompts/`. Rewrite, proofread and continue use the FAST model; the rest use SMART. Document text goes only in the user message, inside delimiters, with any closing delimiter in the text defused, and every prompt says the text is data, never instructions.
- **Endpoints:** `GET /api/v1/ai/status`; `PUT /api/v1/ai/settings` (owner switch); `POST /api/v1/ai/run` (server-sent events: `delta`, `done` or `error`); admin: `GET|PUT /api/v1/admin/organizations/{id}/ai` (block, monthly token limit, reason required). Refusals are ordinary JSON errors before the stream starts.
- **Rules:** AI is off per organization until the owner turns it on; a Super Admin can block it (the owner then cannot switch it on). The caller must be able to read the file; delegated content access is refused. Per-feature input caps (summaries and questions read the first 60,000 characters); 20 runs per minute per user; a monthly token budget per organization (default 2,000,000, overridable); at most 16 runs at once. The usage table (`V16__ai.sql`) holds counts only, never text; each run is audited without text.
- **Frontend:**
  - Editor-core: an `AiClient` contract, so editor packages never see the server.
  - Portal: a streaming client that sends the token and renews it once on a 401; an owner-only "AI settings" page (switch and usage).
  - Docs editor: an AI menu in the toolbar (hidden if the platform has no AI; explains why when off), a suggestion card (rewrites show removed words struck through and added words highlighted; written text is shown formatted) that changes the document only when accepted, a side panel to summarize and to ask questions (answers quote passages; click one to find it), and refusal and error messages. An answer is refused if the text it was meant for changed while it was written.
  - Super Admin console: an AI card on the organization page (status, usage, Block or Unblock, monthly limit).

**Verification:**
- Backend: `./mvnw clean verify` → 179 tests, 178 passed, 1 skipped (`B2LiveTest`). New: provider against a local streaming server 6, integration 9 (switches and access, streaming and usage, model tiers and ask history, prompt-injection delimiters, validation and size caps, provider errors, monthly limit, per-user rate limit, Super Admin block and limit), registry 4, rate limiter 2. `V16` also ran on MySQL.
- User app: lint, typecheck, build, 191 tests on one worker (new: streaming client 6, SSE parser 2, Markdown, diff and applying answers 10, editor AI flows 11, settings page 3). Admin app: 21 tests, typecheck, lint, build.
- Checked in a browser on this branch (port 8081, separate MySQL database, backend set to `AI_PROVIDER=groq` pointing at the local server): the owner switched AI on; Help me write streamed a formatted suggestion and Insert placed it; Proofread on a selection showed the word diff and Replace applied it; Summarize and Ask worked in the panel with clickable quotes; usage was recorded (1,251 tokens) with the right models per feature; the panel fills the screen on a phone. The Super Admin card is covered by tests only (not opened in a browser).

**Limitations:**
- The Groq model ids are not hard-coded: set `AI_MODEL_FAST` and `AI_MODEL_SMART` (AI stays unavailable until both are set). Names change over time; check them against Groq's current list.
- A monthly limit is checked before a run starts, so a run can overshoot it once.
- Rate and concurrency limits count per server instance.
- Selection-based actions replace the selected text but keep only the formatting of its first character.
- Long documents are cut, not summarized in chunks.

### Change — Editors step D6: accessibility, fonts and documentation (2026-11-07)

Trimmed on request (least effort): this step was verified by **builds only**; the final test runs were skipped on purpose.
- **Accessibility:** automated checks (axe-core 4.14, a dev-only tool under MPL-2.0) on the editor in its default state, with the find bar and outline open, in the page setup dialog, and in the AI menu, panel and suggestion card; every toolbar control has a name and toggles expose their state. Fixes: heading order in the AI panel, and a darker empty-page placeholder (it was too light on white). Colour contrast cannot be measured without a real layout and was only adjusted by hand.
- **Fonts:** Word's common fonts are answered by metric-compatible open fonts (SIL Open Font License, via `@fontsource`) when the device does not have the real one: Calibri → Carlito, Cambria → Caladea, Arial → Arimo, Times New Roman → Tinos, Courier New → Cousine, Georgia → Gelasio. The device's own font is used first, and a font file is only downloaded when a document uses it (latin subset).
- **Not done:** measuring open time and typing speed on very large documents (the plan's 2-second and 16-ms targets are unmeasured), and checking the editor's look in light and dark themes in a browser (the page itself stays white by design).
- **Docs:** `docs/deployment.md` now covers the AI settings and editor limits.

### Change — The Docs editor becomes its own app (2026-11-07)

Requirement correction: the document editor is a separate frontend project on its own port (its own subdomain in production), not part of the storage portal.
- **New project `cloud-disk-docs-frontend`** (port 5177): React, Vite, Redux Toolkit, Fluent UI, like the others. It holds the editor packages (`editor-core`, `editor-docs`, `editor-preview`, moved from the portal). Routes: `/` Docs home (start a blank document; recent documents; all documents; search by name), `/new` (creates a blank document and opens it), `/d/:fileId` (the editor). The home lists Word documents only, from the same library the portal shows (`/recents`, `/views/documents`, `/search`). Documents are saved to the storage through the same API, so they appear in the portal.
- **No separate sign-in:** the Docs app uses the portal's session. The refresh cookie is on the API and `SameSite=Strict`, so apps on one site share it. Someone not signed in is sent to the portal's sign-in page (`?next=` the Docs address) and comes back; the portal's sign-in only accepts a `next` inside the Docs app's address.
- **Storage portal:** double-click or Open on a `.docx` opens it in a new tab in the Docs app (`VITE_DOCS_APP_URL`); "New document" in a folder opens `/new?drive=&folder=` there; old `/open/:id` links redirect. Other files are downloaded again, as before the viewer existed: the image, video, PDF and text preview that the portal had is no longer in the portal (the Docs app still has it for direct links). The portal keeps the owner's AI settings page.
- **Backend:** only configuration: `CORS_ALLOWED_ORIGINS` must include the Docs origin (defaults and `.env.example` now list port 5177; your real `.env` needs it too). Buckets provisioned before that need their CORS rules updated (see `docs/deployment.md`).

**Verification:** portal: lint, typecheck, build, 113 tests (new: .docx opens in the Docs app, New document goes to it, other files download). Docs app: lint, typecheck, build, 90 tests (the editor, AI and conversion tests moved with the packages; new: Docs home lists documents, search, new document, open a card). Checked in a browser: the Docs app picked up the portal's session, listed documents, searched, created "Untitled document (2).docx" (it also appeared in the portal) and opened it; the portal asked for `http://localhost:5177/d/3` when a document was double-clicked.

**Not done / limits:**
- Signing out: the Docs app has no sign-out button (sign out in the portal).
- A first visit signed out redirects to the portal and back; not checked in a browser.
- "All documents" and search read up to 100 results and then keep only .docx files, so someone with very many other documents may not see every Word document there.
- The Super Admin console is unchanged and was not rebuilt after this change.


### Change — The Sheets editor, its own app (2026-11-08)

Spreadsheets open in a new app, `cloud-disk-sheets-frontend` (port 5178), built like the Docs app and on the same backend, storage, versions, edit lock and AI layer. Scope, decisions and fidelity targets: `docs/editor-sheets-feature-set.md`.
- **Stack:** Univer 1.2 core and its Apache-2.0 presets (filter, sort, conditional formatting, data validation, find and replace, hyperlinks, notes). No Univer Pro. Our own converters: ExcelJS 4.4 (.xlsx), Papa Parse (CSV), SheetJS CE 0.20.3 (legacy .xls/.ods, from the SheetJS CDN, not the stale npm package).
- **Formats:** .xlsx and .csv are edited and saved in place. .xls, .ods and .xlsm open view-only with "Save as .xlsx copy". Our .xlsx files carry a hidden `cloud-disk/workbook.json` (hash-checked, like the Docs editor part), so they reopen exactly; after an outside edit the XML is read. Notice on open names what a save would drop (charts, images, pivot tables, macros, comments, conditional formatting, filters, …).
- **Autosave** 5 s after the last change (new per-editor option in `editor-core`; also a `saveCopy` hook). Edit lock, 409 conflicts and version history come from the shared shell.
- **App routes:** `/` home, `/new`, `/s/:fileId`. Portal: spreadsheets open there (`VITE_SHEETS_APP_URL`), "New spreadsheet" in folders, sign-in `next` accepts the Sheets address.
- **Backend:** only the 5178 CORS origin and six `sheets.*` AI features with versioned prompts (formula help, explain, analyse, generate table, clean data with fixed options or a custom one, chart suggestions as JSON checked against real headers). Delimiter defusing now covers `document`, `passage`, `data` and `formula` blocks.
- **AI panel:** applies nothing without a click; table and clean results are previewed (clean says how many cells change and is refused if those cells changed meanwhile); chart suggestions show a small preview in the panel and are not stored in the file.

**Verification:**
- Sheets app: lint, typecheck, build, 76 tests (converter and fidelity suite 30, plus a corpus round trip of 5 generated files and any real files dropped into the fixtures folder: Tier A values, formulas with results, shared formulas, formats, styles, merges, sizes, hidden rows and columns, freeze panes, sheets; idempotence; hidden part and outside edits; Tier C detector; formula shifting; CSV with BOM, quotes, semicolons; .xls and .ods; AI helpers 6; editor with a fake engine 8; home 3; shell and others carried over).
- Portal: lint, typecheck, 113 tests (extended: spreadsheets and New spreadsheet open the Sheets app).
- Backend: `./mvnw clean verify` → 182 tests, 0 failed, 1 skipped (`B2LiveTest`); new: spreadsheet AI features in the registry and integration tests.
- Checked in a browser against a private backend (port 8082, own MySQL database, local storage; portal on 5179): sign-in hand-off from the portal to Sheets, Blank spreadsheet created and opened in Univer, typing and a formula autosaved (version 2 in history, reopened identically after reload), a second tab opened read-only with "Edit here instead", a semicolon CSV from storage opened, and AI formula help ran through the backend against a local Ollama model and the formula was inserted.

**Not done / limits:**
- Not run against real Groq (local Ollama only, one model). Explain, analyse, table, clean and chart were covered by tests only, not run in a browser.
- Not opened in real Excel, Google Sheets or LibreOffice (none here); the corpus is generated by script. Real files can be dropped into `editors/editor-sheets/test/fixtures/`.
- Not written to .xlsx yet: conditional formatting, data validation, filters, notes, hyperlinks, named ranges (kept exactly only in files edited here, noted in the feature set as v1.1). No charts, pivots or images. No print or PDF.
- The app has its own copy of `editor-core`; sharing one copy with the Docs app is a follow-up. Formulas calculate on the main thread (no worker). Open time on 10,000-row files and the Univer chunk size (1.9 MB gzipped, lazy) were not measured against the targets.
- Not checked in a browser: phone width, the old-format "Save as .xlsx copy", opening from the portal by double-click (the pane blocks `window.open`; the URL is covered by a test).

### Change — The Images editor, its own app (2026-11-09)

Images open in a new app, `cloud-disk-images-frontend` (port 5179), built like the Docs and Sheets apps on the same backend, storage, versions, edit lock and AI layer. Scope, decisions, acceptance criteria and the image-AI provider comparison: `docs/editor-images-feature-set.md`.

- **Editor:** our own non-destructive pipeline in TypeScript (pure functions over RGBA pixels; canvas only to decode, show and encode) instead of Filerobot, which lacks exposure, highlights/shadows, sharpness, HSL and curves and brings its own UI. Rotate, flip, crop (free, original, 1:1, 4:5, 3:2, 4:3, 16:9, 9:16; drag box and corners; keyboard), resize (locked ratio, 25–100 %), adjust (exposure, brightness, contrast, highlights, shadows, saturation, vibrance, warmth, tint, sharpness), eleven looks with strength (per-channel curves, saturation and toning), HSL for eight colour ranges, RGB/R/G/B curves (monotone cubic), undo/redo (100 steps; a slider drag is one step), hold-for-before and a split compare. Sliders work on a preview of at most 1600 px; the full image is rendered only to save.
- **Formats:** JPEG, PNG and WebP are saved as new versions; GIF (first frame), HEIC/HEIF (heic2any, loaded only for HEIC), AVIF and BMP are saved as a copy (PNG or JPEG). Saving re-encodes, so EXIF (including GPS) is not kept; orientation is applied first.
- **Saving:** explicit (no autosave). New `editor-core` options: `EditorModule.autosave: false` and `EditorProps.save()` (flushes the save controller and reports failure). "Save as copy" uses the existing `saveCopy` hook. The original upload is never merged away by the 10-minute coalescing rule, so it stays restorable.
- **Edit by prompt:** an AI tab with suggestions; the current picture (JPEG, up to 1024 px) and the instruction go to `POST /api/v1/ai/images/edit`; the result is shown to Accept (becomes the starting image, scaled back to the picture's size; undo works) or Discard.
- **Backend (nested repo, branch `claude/images-editor`):** `ImageEditProvider` (provider-neutral) with `NoopImageEditProvider` and `CloudflareImageEditProvider` (Workers AI multipart API; shrinks the input to fit 512×512, asks for the input's aspect ratio up to 1024 px, maps the safety filter (3030), key, throttling and outage errors to safe messages); `POST /api/v1/ai/images/edit` (read access, delegated access refused, organization switch and block, PNG/JPEG only by signature, size limit, per-user rate, per-organization monthly count of successful edits, concurrency); `GET /api/v1/ai/status` gains `images` (available, usable, limit, used, provider, max sizes). Usage goes to `ai_usage` as `images.edit` with 0 tokens (it does not use the text token budget); audit `AI_IMAGE_EDIT` without the prompt. No migration. Text AI stays on Groq. Config: `AI_IMAGE_PROVIDER`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_API_BASE_URL`, `AI_IMAGE_MODEL`, `AI_IMAGE_MONTHLY_EDITS_PER_ORG`, `AI_IMAGE_MAX_INPUT_BYTES`, `AI_IMAGE_MAX_CONCURRENT`, `AI_IMAGE_REQUEST_TIMEOUT_SECONDS`; 5179 added to the CORS defaults and `.env.example`.
- **Portal:** images open in the Images app (`VITE_IMAGES_APP_URL`); sign-in `next` accepts the Images address; SVG and other files still download.

**Verification:**
- Backend: `./mvnw verify` → 196 tests, 0 failed, 1 skipped (`B2LiveTest`). New: `CloudflareImageEditProviderTest` (8, against a local HTTP server that speaks the Workers AI format: multipart fields, 512 px reference, output sizes, safety filter, key, throttling, retry, no image, not configured, signatures) and `AiImageEditIntegrationTest` (6, with a fake provider: status, off/blocked/not set up, access and image checks, monthly limit counting only successful edits, usage and audit without the prompt). Tests never call Cloudflare.
- Images app: lint, typecheck, build, 66 tests (pipeline 21: geometry, resize, crop maths, curves, adjustments, HSL, looks, sharpen, render order, history; formats 2; editor with a fake codec 13: save as version, undo/redo, rotate + crop + resize, typed width, looks and compare, HSL and curves, GIF copy, viewers, unreadable file, AI accept/discard/refusal/not set up/off; backend image call 2; home 3; shell incl. explicit save 7; others carried over).
- Portal: lint, typecheck, build, 114 tests (extended: images open in the Images app, SVG downloads; `safeNext` accepts the Images address).
- Checked in a browser against a private backend (port 8081, own MySQL database `cloud_disk_images_test`, local storage; portal on 5175, Images on 5179) with the Cloudflare provider pointed at a local stand-in server: portal sign-in carried over to Images; JPEG adjusted (exposure), Sunset look, split compare, square crop dragged and applied, saved → version 2 is a 1200×1200 JPEG without EXIF and version 1 (the upload) is kept; restore of version 1 from history; edit by prompt "Add snow" → the provider sent a 512×512 reference and asked for 1024×1024, the result was accepted (scaled back to 1200×1200) and saved as "Mountain lake (edited).jpg"; usage row `images.edit` with 0 tokens and an audit event; HEIC and GIF opened with the copy notice; home lists and searches images; phone width; no console errors.

**Not done / limits:**
- Not run against the real Cloudflare API (no account or token here). The request format follows Cloudflare's documentation and is covered by the local stand-in; check the first real edit after adding a key.
- FLUX.2 [klein] regenerates the picture at up to 1024 px: fine detail and faces can change, and "remove the background" gives a plain background, not transparency. Masked edits and true background removal are later items.
- Edit settings are not stored with the file: after saving and reopening, the saved pixels are the new starting point (the original remains in version history).
- The per-organization image limit is a platform default (`AI_IMAGE_MONTHLY_EDITS_PER_ORG`); a Super Admin override per organization (like the token limit) is a follow-up. The Super Admin console does not show image usage yet.
- Rendering runs on the main thread; on very large photos the save can take a second or more. A worker is a follow-up. Not checked in Safari (WebP encoding there falls back to an error asking for another format).
- The app has its own copy of `editor-core` (now three copies across Docs, Sheets and Images); one shared package is a follow-up.

### Change — Sharing with people: viewer or editor, direct or two-factor (2026-11-14)

- **Options when sharing** (Share dialog, People tab): access level VIEWER (view, download) or EDITOR (also edit file contents in the Docs, Sheets and Images apps); access mode DIRECT (works at once) or TWO_FACTOR. Sharing again with the same person changes both (a mode change clears earlier unlocks).
- **Two-factor flow:** the grantee asks for a number of days (1, 3, 7, 1 month, custom; the server accepts 1 to 90). A 6-digit OTP is emailed to the person who shared (their organization's owners if that person is gone), never to the requester; it is stored salted and hashed, valid 15 minutes, 5 wrong attempts kill it, one request a minute. Entering it unlocks the share for the chosen days; the unlock is checked against the clock on every request, so it simply stops working afterwards and a new OTP is needed. Tables `share_access_grants` (V17) and two columns on `node_shares`.
- **Enforcement:** `ShareAccess` finds the shares covering an item and whether each is usable. `FileSupport.nodeOrShared` / `driveOrShared` are used only by the editor paths (content, edit session, versions, saves via the upload-complete step, AI). File operations (rename, move, trash, delete) never accept a share, so an EDITOR share cannot change the file system. Locked two-factor shares answer 403 with `error.code = TWO_FACTOR_REQUIRED` and `error.shareId`; a viewer asking to edit gets 403 "View-only access".
- **Portal:** Share dialog options; Shared with me shows level and state and opens documents, spreadsheets and pictures in their apps; `UnlockDialog` (days, then code); Shared by me shows the options.
- **Verified:** backend `ShareAccessIntegrationTest` (4: direct viewer, direct editor saving a version, full OTP flow with expiry and a second request, wrong-code lockout and mode switching); portal tests for the dialog and the unlock dialog.
- **Limits:** the editor apps do not have their own unlock screen: when a two-factor share is locked or expired they show the 403 message, which points to Shared with me in the portal. An unlock that ends during an edit stops the next autosave (403) until the user unlocks again. Folder shares: browsing inside a shared folder uses the same unlock. Link shares (public links) are unchanged.

### Change — Light/dark theme toggle in the Images app (2026-11-14)

The Images app followed the system colour scheme only. It now uses the same `ThemeProvider`/`ThemeToggle` as Docs and Sheets (`lib/theme.tsx`): light by default, a sun/moon button in the home header and in the editor header (new `headerExtra` slot on its `EditorShell`), the choice is remembered in `localStorage` (`cd-theme`) and set as `data-theme` on `<html>`. The Fluent theme and the CSS variables in `global.css` follow it. Verified with the theme unit test, lint, typecheck, build and the app's 68 tests; not checked in a browser (the app needs a signed-in backend session).

### Change — Select mode in the file browser (2026-11-14)

Single click on a file or folder now only outlines it (no selection, no checkboxes, no bulk bar); double click or Enter opens it, and a folder's name no longer opens it on a single click. A small "Select" text above the list turns on select mode: checkboxes appear (also on tiles), clicking items selects them one by one (Shift+click for a range, Select all in the header), the selection bar appears, and "Cancel" returns to normal mode. In normal mode the arrow keys move the outline, F2/Delete act on the outlined item; Ctrl+A works in select mode only. Search, Favorites and the other result lists are unchanged. Tests: portal 120 pass (new: outline-only click and double click to open; Select/Cancel).


### Feature — Large file sharing on the landing site (2026-11-16)

`cloud-disk-landing` now has `/send` (WeTransfer-style: drop files, optional recipient emails and message, direct-to-storage multipart upload with progress, cancel, copyable link) and `/d/<link>` (download page). Backend: V18 tables, `PublicTransferController`, `TransferService`/`TransferMaintenanceService`, `TransferScheduler`. Limits: 50 GB per transfer, 15-day retention, then every object version is deleted from a dedicated bucket that uses its own credentials (`TRANSFER_B2_*`). Design, endpoints and operations: `coude-disk-bakend/agent.md` ("Large file sharing") and `docs/deployment.md`. Known gap: sender email is not verified.


### Change — Unfinished editor features hidden behind a flag (2026-11-16)

Docs and Sheets editors: every greyed "Coming soon" control (header Star/Move/Comments/Meet, Share without a link and the sharing-options chevron, toolbar Paint format, Add comment, Print, decimals, Borders, Link, Comment, Chart, Functions, "More styles", and the Insert/Tools/Extensions/Help menus) is now hidden unless `VITE_SHOW_UNFINISHED_FEATURES=true` is set in that app's `.env` (`showUnfinishedFeatures()` in `editor-core/src/flags.ts`; default `false`, listed in each `.env.example`). The Images editor has no placeholder controls, so nothing was hidden there. Verification: Docs lint (0 errors), typecheck, 101 tests, build; Sheets lint, typecheck, 82 tests, build; new tests cover hidden and shown states.


### Feature — Video player in the Images app (2026-11-16)

The Images app (`cloud-disk-images-frontend`) now also opens videos: `videoModule` (`editors/editor-images/src/video`) is a view-only module that streams the file from its short-lived storage URL in a native `<video controls>` (seeking works via range requests). Any extension is accepted (a broad list, plus the server's VIDEO category or a `video/*` MIME type). Formats the browser cannot decode (AVI, WMV, FLV, some MKV/HEVC) show a message pointing to Download. The storage portal opens videos (file browser and shared pages) at `/i/:id` in the Images app. No backend change. Not done: the Images home page still lists only pictures; the storage URL lasts about 5 minutes, so seeking in a very long session may need a page reload; no transcoding, so unsupported codecs cannot be played. Verification: Images lint, typecheck, 83 tests (new: detection, player, module choice), build; portal lint, typecheck, 120 tests, build. Not tried with a real video in a browser.


### Recovery — Frontend projects restored after an accidental `git filter-repo` (2026-11-24)
`git filter-repo --invert-paths` followed by `rm -rf .git` removed the six web frontends from the working tree (they were never pushed). They were rebuilt from local evidence only: the five Claude Code worktrees (committed state up to 2026-11-14 ~07:39Z), a chronological replay of the file edits and scripts recorded in the session transcripts after that point (HarDisk rename, login redesign, select mode, theme toggle, unfinished-feature flag, Images video player), and, for `cloud-disk-landing`, the original sources embedded in the Next.js dev-build source maps. All five Vite apps type-check, build and pass their test suites. Known gaps: `package-lock.json` is not updated for `lucide-react` in the portal and Super Admin apps; the landing app's `package.json`, `tsconfig.json` and `next.config.ts` were reconstructed from its installed dependencies and recorded build config; landing has no lockfile. Evidence and the files displaced during recovery are in `_recovery/`.

### Change — Yearly prepaid billing with a free trial (2026-11-27)
Replaces the pay-for-what-you-use billing of 2026-10-30. Approved decisions: (1) a trial gives admin-set storage and the owner picks the size of the first yearly bill; (2) mid-year upgrades are paid first, downgrades apply at renewal; (3) renewal is billed 15 days early and features lock when the year ends unpaid; (4) existing organizations get a fresh trial.

**Backend:** `V22__yearly_billing_trials.sql` (trial settings on pricing versions; trial dates and chosen size on organizations; bill kind and target size; `organization_trial_grants`; drops `uk_invoices_subscription_period` so a withdrawn bill can be re-issued). `BillingCycleServiceImpl` owns the lifecycle. Subscription `PENDING` → `ACTIVE`; bills can be `VOID`, and money that arrives for a withdrawn bill is refunded. A new price now reaches existing plans at renewal. Allocation cannot grow past a smaller next year. New endpoints: `DELETE /billing/subscriptions/pending`, `GET|POST /admin/organizations/{id}/trial`; `POST /billing/subscriptions` now returns the billing overview; `GET /public/pricing` includes `trialDays`; organization search also matches member emails. `subscription_segments` is no longer used (table kept).

**Frontends:** admin Pricing page has trial days and storage, an individual-trial search, and a trial card (also on organization detail); the monthly/annual choice is gone. User app Billing shows the plan state, trial countdown, yearly quote, upgrade/downgrade effects and cancel; the banner follows the new states. Landing pricing says billed yearly and shows the trial. The portal's tests now set their own app URLs (the live `.env` had broken two of them).

**Verification:** backend `./mvnw clean verify` → 224 tests, 223 passed, 1 skipped (`B2LiveTest`). `V22` applied on a throwaway MySQL 9.2 server, where the 19 billing and Razorpay tests of that moment also passed. Admin app: typecheck, lint, 24 tests, build. User app: typecheck, lint, 120 tests, build. Landing: typecheck only. Not run in a browser, with real Razorpay keys, or against a copy of live data.

**Limitations:** locking and bills follow the 5-minute job, so a lock can lag the trial end by a few minutes; public share links keep working while an organization is locked (unchanged); there is no cancellation; trials are per organization, so a new registration with another email gets a new trial; `REFUND_FAILED` payments still need a manual re-check; backend emails and invoices still say "Cloud Disk".
