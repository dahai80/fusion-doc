# 变更日志 (Changelog)

本格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [1.0.5] — 2026-08-07

### Added — 商用级安全加固
- **密码哈希升级**: scrypt 慢哈希 (N=2^15, r=8, p=1)，替换易被离线爆破的 HMAC-SHA256；旧存量哈希在登录时自动透明升级
- **限流中间件接线**: `/api/auth/*` 10 次/分钟、其余 API 120 次/分钟，防认证爆破与滥用
- **生产环境 JWT fail-fast**: `NODE_ENV=production` 下缺失 `JWT_SECRET` 启动即拒绝 (exit 1)
- **默认绑定 127.0.0.1**: 生产环境默认仅本机监听，显式 `FUSION_DOC_HOST=0.0.0.0` 才暴露并告警
- **数据备份机制**: 在线热备 (WAL 一致性快照) + `POST /api/system/backup`、`GET /api/system/backups` (admin) + `scripts/backup.sh` (cron 定时, 保留份数清理)
- **CI 安全审计闸**: `npm audit --audit-level=high --omit=dev` 加入 CI，high/critical 漏洞即失败
- **安全文档**: `SECURITY.md` 漏洞披露流程 + 生产部署清单 + 反代 TLS 示例
- **变更日志**: `CHANGELOG.md`

### Fixed
- 版本号报告统一: banner / `/api/health` / `/api/branding` / `X-Fusion-Doc` 头四处改读 `package.json`，消除硬编码 `1.0.0` (PR #32)

## [1.0.4] — 2026-08-07

### Changed
- `FUSION_MLX_URL` 默认改回 11432 (经 fusion-gateway 统一组网方案B; env 可覆盖回直连 11434) (#28/#30)
- 根目录后台 detach 启动脚本 `start.sh` (fusion-studio UpstreamServiceManager 自动拉起) (#31)

## [1.0.3] — 2026-08-06

### Changed
- `FUSION_MLX_URL` 默认 11432→11434 (方案A 直连) (#25/#26)
- `FUSION_MLX_API_KEY` 去字面量 + 调用时 fail visibly 守卫 (§2.2)

## [1.0.2] — 2026-08-05

## [1.0.1] — 2026-08-04

### Added
- 安全加固 + 端口迁移 (#6) + License → Apache-2.0
