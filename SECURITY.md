# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability, do **not** file a public Issue.

Report it privately via:
- GitHub Security Advisory: repo -> Security -> Report a vulnerability
- Email: security lead (see repo Maintainers)

Please include: impact scope, reproduction steps, suggested fix direction. We will acknowledge receipt within **5 business days** and credit you after the fix is released.

## Supported versions

| Version | Status |
|---------|--------|
| 1.0.x | ✅ security maintained |

## Security features

### Authentication & passwords
- **Password hashing**: scrypt slow hash (N=2^15, r=8, p=1, keyLen=64B), resists offline cracking
- **Backward compatible**: legacy HMAC-SHA256 hashes auto-upgrade transparently to scrypt on login
- **JWT**: HS256 signing, production requires the `JWT_SECRET` env var (fail-fast on missing)
- **Session expiry**: default 24h, configurable via `SESSION_EXPIRY`

### Access control
- **Rate limiting**: auth endpoints `/api/auth/*` 10/min, other API 120/min (in-memory counter, anti brute-force)
- **Admin privileges**: system-admin endpoints (backup etc.) enforce `role === 'admin'`
- **Dev-mode bypass**: `NODE_ENV=development` + `X-User-Id` header works only in dev, inert in production

### Network
- **Bind address**: production defaults to `127.0.0.1` (localhost only); explicit `FUSION_DOC_HOST=0.0.0.0` required to expose
- **TLS**: built-in HTTPS via native Node `tls` (set `FUSION_DOC_TLS_CERT` + `FUSION_DOC_TLS_KEY`); otherwise HTTP only, commercial deployment should front a reverse proxy (Nginx/Caddy) to terminate TLS
- **CORS**: production defaults to localhost origins only; allowlist via `CORS_ORIGINS`

### Data
- **SQL injection**: all queries parameterized (`prepare().run()`), no string concatenation
- **SQLite**: WAL mode + foreign_keys + busy_timeout, data-reliability guarantee
- **Backup**: online hot backup (WAL-consistent snapshot), API-triggered and cron-scheduled

### AI key
- **FUSION_MLX_API_KEY**: read from env var only, literal hardcoding forbidden
- **Fail visibly**: missing key throws on call, never silently passes through

## Production deployment checklist

```bash
# 1. Required env vars
export JWT_SECRET="$(openssl rand -hex 32)"      # JWT signing secret (required)
export FUSION_MLX_API_KEY="..."                  # Fusion-MLX API key (required)
export NODE_ENV="production"                     # production mode
export FUSION_DOC_HOST="127.0.0.1"               # localhost only (default; use 0.0.0.0 behind a reverse proxy)

# 2. Optional hardening
export CORS_ORIGINS="https://your-domain.com"    # CORS allowlist
export SESSION_EXPIRY="86400"                    # session expiry (seconds)

# 3. Scheduled backup (crontab)
0 2 * * * cd /path/to/fusion-doc && bash scripts/backup.sh 30
```

### Reverse proxy + TLS (example: Caddy)

```
your-domain.com {
  reverse_proxy 127.0.0.1:11449
}
```

## Known limitations

- Rate limiting is in-memory (single-instance); multi-instance deployment needs a Redis backend
- No SSO integration, local account system only
