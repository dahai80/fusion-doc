# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
