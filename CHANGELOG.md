# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.11] — 2026-10-27

### Changed — dependency major upgrades (issue #55)
- **react-router-dom 6.28 → 7.18.4** (PR #56): `<BrowserRouter>` API compatible; client routes unchanged
- **@tiptap/* 2.x → 3.32.0** (PR #57): major bump across the editor stack (starter-kit, extensions, suggestion); dropped unused collab/yjs/lowlight deps; distinct `PluginKey` per Suggestion instance (slash commands, bilinks) — v3 crashes on shared keys; smoke fixups: `PUT /api/pages` 500 (authz `getPage` received `app` where `db` expected, 4 call sites in `server/controllers/page.js`) and client double `/api` prefix in 4 components. Eliminates all 43 moderate advisories in the tiptap 2.x / react-router 6.x chains; `npm audit --audit-level=high` clean

### Added — shell host theme/language sync (issue #58, PR #59)
- **`client/src/lib/shell-bridge.js`**: when embedded in fusion-web-shell, consumes host bridge events — `theme` → `useUIStore.setTheme`, `lang` → `useLangStore.setLang` — and answers heartbeat `ping` with `pong` (host SDK liveness detection now marks fusion-doc alive)
- **`client/src/stores/langStore.js`**: `zh`/`en` language store (persisted to `fusion-doc-lang`) + `t(zh, en)` helper + `useT()` hook; all user-visible strings across 19 components translated; Settings page gains real theme/language controls (standalone mode; embedded mode follows the host)
- **HomePage fix**: Fusion-MLX status read nonexistent `health.mlx` — now `health.checks.mlx.ok` (showed "disconnected" unconditionally)

### Fixed — deep links break client assets (issue #60, PR #61)
- **SPA fallback `<base>` injection**: the build uses relative base `./` (one bundle serves root + `/shell/` mount), so direct load / refresh of a nested route (`/page/<uuid>`) resolved `./assets` against `/page/` and MIME-crashed. The server now injects `<base href="/">` for nested paths and `<base href="/shell/<manifest-id>/">` for shell-proxy callers (detected via the gateway-injected Bearer service key, timing-safe compare). 5 new unit tests (suite 70/70)

## [1.0.10] — 2026-10-26

### Fixed — CI green again + dependency security (issue #53)
- **Client high-severity advisories cleared** (main had been red since 2026-10-24: the CI `audit` job's client `npm audit --audit-level=high --omit=dev` gate failed on advisories published after the v1.0.9 lockfile was cut). `npm audit fix` in `client/` (semver-compatible, lockfile-only): markdown-it 14.3.2 → 14.3.3 (quadratic-time DoS: GHSA-r7fv-28h4-cvq7 / GHSA-vfgh-jcmw-g37q / GHSA-gfr2-rv44-r23c / GHSA-253c-mchw-3w2r), prosemirror-view → 1.42.8 (XSS in paste handling: GHSA-c8x8-7fp4-3x9w). Client audit now exits 0 at the high gate; 43 moderate remain in the tiptap 2.x / react-router 6.x chains (no non-breaking fix, below the gate)
- **De-flaked config fail-closed test**: `tests/unit/test-identity-tenant.js` probe set `FUSION_DOC_LOCAL_AUTH = ''` (falsy), so the `.env` loader — which fills only unset variables — could leak a developer-local `.env`'s `FUSION_DOC_LOCAL_AUTH=1` into the spawned probe and skip the expected `process.exit(1)`. Probe now sets `'0'`, blocking the fill and evaluating false under `=== '1'`

## [1.0.9] — 2026-10-24

### Added — Union Web shell remote module registration (issue #51, PRD R-6)
- **Manifest self-registration**: on startup the server reads `client/manifest.json` (PRD §5.1 schema, id `fusion-doc`, category `infra`, devices `desktop`/`mobile-readonly`) and POSTs it to `fusion-gateway` `POST /api/v1/shell/manifests` (idempotent upsert, admin-key auth), then heartbeats on an interval. Fire-and-forget — gateway unreachable never blocks boot; only the `primary` instance role registers. Client: `server/integrations/fusion-gateway.js`, orchestration: `server/services/shell-register.js`
- **Shell service credential**: `FUSION_DOC_SHELL_API_KEY` env or auto-generated + persisted to `data/shell-api-key.json` (0600). The gateway `/shell/fusion-doc/` proxy strips the caller's session and injects this credential upstream (`middleware/auth.js` accepts it via `timingSafeEqual` as a `shell`-tenant `operator` principal; admin endpoints still require admin). Tenant/role configurable via `FUSION_DOC_SHELL_TENANT`/`FUSION_DOC_SHELL_ROLE`
- **Embedded dual-mode UI**: `?embedded=1` or mounting under `/shell/fusion-doc/` switches the client to embedded mode — sidebar/status-bar chrome hidden (R-8 ③), local login/setup gates skipped (session belongs to the shell host, R-8 ④), API base rebased to the shell proxy path, no token attached, no local logout redirect on 401. Router `basename` aligns to the mount path
- **Relative build base**: `base: './'` in `client/vite.config.js` — one bundle serves both root deployment and the `/shell/fusion-doc/` sub-path
- **Dev port migration**: client dev server moved `5173` (reserved port, forbidden for business use) → `11477`, registered in `architecture/port-registry.yaml` as `fusion-doc-web-dev`; Union Web dev HMR via `FUSION_DEV_MODULES=fusion-doc:11477`
- **Docs**: README (EN/CN) Union Web integration section
- **Tests**: `tests/unit/test-shell-register.js` — 10 cases (service-key env priority / generation + config write-back / re-read stability, registration body assembly with package.json version authority, manifest contains no secrets, auth middleware shell-credential acceptance in both identity and local-auth modes, wrong/short credential fall-through, branch inert without config)

> Note: the issue requested "Module Federation remoteEntry.js" dual-mode build, but the PRD (§5.2 "零构建耦合，无 Federation 配置") mandates the iframe mechanism with zero build coupling — implemented per PRD. See PR description for the conflict resolution.

## [1.0.8] — 2026-09-06

### Fixed — Seed plaintext password hardening (issue #48)
- **`verifyPassword` rejects non-hash storage**: the legacy HMAC-SHA256 fallback branch parsed any stored value with `split(':')`, so a plaintext seed (e.g. `admin123`, no colon) produced `salt=undefined` and threw / mis-evaluated. Now stored values must be either `scrypt:`-prefixed or a valid `salt:hash` pair (≥2 non-empty segments); everything else returns `false` with a warning. Plaintext seeds can no longer log in and no longer risk an uncaught throw
- **Login auto-upgrade now runs in JSON-store mode**: the plaintext→scrypt transparent upgrade was guarded by `&& this.db`, so legacy/seed hashes in JSON-file mode were never migrated. Removed the guard; JSON mode persists the upgraded hash back via `writeJSON('users', id, …)`. SQLite and JSON stores both upgrade now
- **Deleted local plaintext seed user files**: 9 runtime residue files under `data/db/json/users/` (untracked, `data/` gitignored) carried plaintext passwords (`admin123`/`test123`/etc.). Removed as defensive cleanup; no seed-creation code path exists, so first-run users are created through the existing `POST /api/auth/setup` flow (forces password ≥8 chars, local-auth gated)
- **Tests**: `tests/unit/test-auth-hardening.js` — 5 cases (scrypt round-trip, plaintext rejection, legacy HMAC compatibility, JSON-mode auto-upgrade persistence, plaintext seed login denial)

## [1.0.7] — 2026-09-03

### Added — Fusion-Identity tenant integration (issue #45)
- **Retired local JWT issuer + user registry**: `fusion-identity` (sibling service, `:11470`) is now the sole JWT issuer and tenant registry for the Fusion ecosystem. fusion-doc consumes rather than self-issuing
- **Auth middleware calls `/api/v1/auth/verify`**: `server/middleware/auth.js` verifies every Bearer token against fusion-identity (fail-closed — no default-tenant degradation). Local HS256 issuer + `users` table kept only behind explicit `FUSION_DOC_LOCAL_AUTH=1` (off by default)
- **Tenant-scoped context**: `X-Tenant-Id` header required on all non-public routes; JWT `tid` must match the header (`AUTH_TENANT_MISMATCH` on mismatch). `req.user.tid` injected into request context
- **Tenant-isolated data plane**: migration `018_tenant_isolation` adds `tenant_id` column to `workspaces`/`pages`/`books`/`chapters` (+ indexes); all list queries and create writes filter/bind by `tenant_id` from context. Cross-tenant access returns `404` (no existence leakage). Role mapped to 4 unified roles (`tenant_admin`/`operator`/`member`/`viewer`); admin gate accepts `tenant_admin`
- **WebSocket collab tenant gate**: `/ws/collab/:pageId` upgrade rejected without a verified `tid` (route already 410-closed as unreleased; gate hardens the future-enabled path)
- **AI token usage reporting**: chat/embeddings/RAG/copilot report token usage fire-and-forget to `POST /api/v1/tenants/{tid}/usage` (never blocks AI responses; skipped in local-auth mode)
- **Tests**: `tests/unit/test-identity-tenant.js` — 14 cases covering cross-tenant denial, missing `X-Tenant-Id` (`AUTH_TENANT_REQUIRED`), tid mismatch, fail-closed on verify error, role mapping, local-auth fallback, config fail-closed

### Fixed — Unified admin gate accepts `tenant_admin` (issue #45)
- **Scattered admin checks excluded `tenant_admin`**: `system`/`graph`/`rag-enhanced`/`user`/`metadata`/`comment`/`file` controllers had local `role === 'admin'` / `role !== 'admin'` gates that rejected the unified `tenant_admin` role, breaking tenant-admin access to backup/restore, user listing, comment/file ownership bypass, and graph/RAG page-visibility. Unified all admin gates to accept `tenant_admin` (shared `require-admin` middleware or inline `admin || tenant_admin`)
- **Graph/RAG page visibility now tenant-scoped**: `accessiblePageFilter`/`accessiblePageIdsFor` returned all pages for admin without `tenant_id` filtering; now scoped to the request tenant (red line 3 — data isolation)

### Fixed — Containerized delivery (issue #41)
- **Dockerfile build stage adds client deps**: `deploy/Dockerfile` build stage only installed root deps, missing `client/` vite (devDependencies), so `npm run build` could not build the client. Changed to install root + client deps stepwise before building
- **Native compile toolchain**: `node:20-slim` (linux/arm64) has no `better-sqlite3` prebuilt binary, requires `python3 make g++` source compile. Toolchain installed only in the build stage; runtime stage copies the compiled `node_modules` (no toolchain, slim image)
- **`node_modules` slimming**: removed native build intermediates (`obj/`/`obj.target/`/`sqlite3.a`/`test_extension.node`/`*.gyp`) + install-time tools (`prebuild-install`/`node-gyp`); runtime keeps only `better_sqlite3.node` (~2MB) + runtime deps
- **Added `.dockerignore`**: prevents `COPY . .` from copying `node_modules`/`data/`/`.env`/`.git`/`.venv`/stale build output into image layers (prevents secret leakage + shrinks build context)
- **`FUSION_MLX_URL` container addressing**: container reaches host MLX via `http://host.docker.internal:11434` (+ `--add-host=host.docker.internal:host-gateway`), noted in README

## [1.0.6-rc.1] — 2026-08-31

> Release Candidate. Fixes three architecture ceilings blocking enterprise commercial use: multi-instance horizontal scaling / large-scale knowledge base / bare exposure (no built-in TLS). Final validation window before GA.

### Added — Architecture ceilings continued
- **Built-in TLS (bare exposure)**: native Node `tls`/`https` implements built-in HTTPS (zero external deps), no longer hard-depends on a reverse proxy.
  - Three-state config: set both `FUSION_DOC_TLS_CERT`+`FUSION_DOC_TLS_KEY` to enable HTTPS; both empty -> HTTP; setting only one fails visibly on startup (`process.exit(1)`), never silently degrades
  - `FUSION_DOC_TLS_REDIRECT=1` (default) enables `:11448` (`FUSION_DOC_HTTP_PORT`) HTTP->HTTPS 301 redirect; `FUSION_DOC_TLS_CA` optional mTLS client-cert validation
  - Enforces `minVersion=TLSv1.2`, `honorCipherOrder=true`, HSTS header; missing/unreadable cert/key files reject startup
- **Multi-instance horizontal scaling (same-machine multi-process)**: SQLite WAL multi-process concurrency model, resolves single-instance write bottleneck.
  - `busy_timeout=10000` set before `journal_mode=WAL`; `BEGIN IMMEDIATE` acquires write lock to serialize write transactions
  - Migration lock `_acquireMigrateLock` + `busy_retry` (60 retries, Atomics.wait 200ms); on concurrent multi-process startup only one runs migrations, the rest queue on BUSY; `SAVEPOINT` per-migration rollback, no half schema left
  - `FUSION_DOC_ROLE=primary|replica` role gating: primary owns single-instance duties (E8 sweep + auto backup), replica only serves requests, prevents duplicate execution/thundering herd across processes; defaults to primary (single-instance backward compatible)
- **Large-scale knowledge base (sqlite-vec ANN)**: `vec0` virtual table approximate nearest-neighbor search, resolves vector linear-scan scale ceiling.
  - `rag_chunks.id` is TEXT, `vec0` accepts only integer rowid -> two-table bridge `rag_chunks_vec` (vec0 auto-increment rowid) + `rag_vec_map` (vec_rowid<->chunk_id)
  - `worker_threads` offloads vector scan; `AI_EMBEDDING_DIM` (default 384 = bge-small-en-v1.5) controls dimension; `KNN_OVERSAMPLE=4` ensures full results after permission filtering
  - Extension load failure (no `vec0.so/.dylib`) degrades back to linear scan, zero regression, does not block startup

### Changed
- `sqlite-vec@0.1.9` + `better-sqlite3@12.11.1` added to dependencies (sqlite-vec resolves platform `vec0.{so,dylib,dll}` via optionalDependencies, loaded via `db.loadExtension`)
- `scripts/setup.sh` `.env` template adds TLS / role / dimension / backup-cycle config entries (commented by default)
- `README.md` adds three architecture-fix sections (built-in TLS / multi-instance horizontal scaling / large-scale knowledge base)

### Tests
- Added 14 behavioral tests (36 all green): TLS three-state + half-config fail visibly (5), vec degradation + KNN logic + two-table mapping (4), migration-lock idempotency + SAVEPOINT rollback + busy_retry + role gating (5)

## [1.0.5] — 2026-08-07

### Added — Commercial-grade security hardening
- **Password hash upgrade**: scrypt slow hash (N=2^15, r=8, p=1), replaces HMAC-SHA256 which is easy to offline-crack; existing legacy hashes auto-upgrade transparently on login
- **Rate-limit middleware wiring**: `/api/auth/*` 10/min, other API 120/min, prevents auth brute-force and abuse
- **Production JWT fail-fast**: `NODE_ENV=production` missing `JWT_SECRET` rejects startup (exit 1)
- **Default bind 127.0.0.1**: production defaults to localhost-only listen; explicit `FUSION_DOC_HOST=0.0.0.0` required to expose (with warning)
- **Data backup mechanism**: online hot backup (WAL-consistent snapshot) + `POST /api/system/backup`, `GET /api/system/backups` (admin) + `scripts/backup.sh` (cron scheduled, retention cleanup)
- **CI security audit gate**: `npm audit --audit-level=high --omit=dev` added to CI; high/critical vuln fails
- **Security docs**: `SECURITY.md` vulnerability disclosure process + production deployment checklist + reverse-proxy TLS example
- **Changelog**: `CHANGELOG.md`

### Fixed
- Version reporting unified: banner / `/api/health` / `/api/branding` / `X-Fusion-Doc` header now read `package.json`, eliminating hardcoded `1.0.0` (PR #32)

## [1.0.4] — 2026-08-07

### Changed
- `FUSION_MLX_URL` default back to 11432 (via fusion-gateway unified networking plan B; env can override back to direct 11434) (#28/#30)
- Root-dir background detach start script `start.sh` (fusion-studio UpstreamServiceManager auto-launch) (#31)

## [1.0.3] — 2026-08-06

### Changed
- `FUSION_MLX_URL` default 11432->11434 (plan A direct connect) (#25/#26)
- `FUSION_MLX_API_KEY` de-literalized + fail-visible guard at call time (§2.2)

## [1.0.2] — 2026-08-05

## [1.0.1] — 2026-08-04

### Added
- Security hardening + port migration (#6) + License -> Apache-2.0
