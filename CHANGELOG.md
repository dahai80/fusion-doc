# 变更日志 (Changelog)

本格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Fixed — 容器化交付 (issue #41)
- **Dockerfile 构建阶段补客户端依赖**: `deploy/Dockerfile` 原构建阶段仅装根依赖, 缺 `client/` 的 vite (devDependencies), 导致 `npm run build` 无法构建客户端。改为分步装根 + 客户端依赖后再构建
- **native 编译工具链**: `node:20-slim` (linux/arm64) 无 `better-sqlite3` 预编译二进制, 须 `python3 make g++` 源码编译。工具链仅装于 build 阶段, runtime 阶段直接拷已编译 `node_modules` (无工具链, 瘦镜像)
- **`node_modules` 瘦身**: 删 native 编译中间产物 (`obj/`/`obj.target/`/`sqlite3.a`/`test_extension.node`/`*.gyp`) + 安装期工具 (`prebuild-install`/`node-gyp`), runtime 仅留 `better_sqlite3.node` (~2MB) + 运行时依赖
- **新增 `.dockerignore`**: 防 `COPY . .` 把 `node_modules`/`data/`/`.env`/`.git`/`.venv`/旧构建产物拷进镜像层 (防密钥泄漏 + 减构建上下文)
- **`FUSION_MLX_URL` 容器寻址**: 容器内连宿主 MLX 走 `http://host.docker.internal:11434` (+ `--add-host=host.docker.internal:host-gateway`), README 补注

## [1.0.6-rc.1] — 2026-08-31

> 候选发布版 (Release Candidate)。修复三项阻塞企业级商用的架构天花板: 多实例水平扩展 / 海量知识库 / 裸暴露 (无内置 TLS)。GA 前最后验证窗口。

### Added — 架构天花板续修
- **内置 TLS (解裸暴露)**: 原生 Node `tls`/`https` 实现内置 HTTPS (零外部依赖)，不再强依赖反代。
  - 三态配置: `FUSION_DOC_TLS_CERT`+`FUSION_DOC_TLS_KEY` 同设即启用 HTTPS；两路径空走 HTTP；仅设其一启动即 fail visibly (`process.exit(1)`)，绝不静默降级
  - `FUSION_DOC_TLS_REDIRECT=1` (默认) 开启 `:11448` (`FUSION_DOC_HTTP_PORT`) HTTP→HTTPS 301 跳转；`FUSION_DOC_TLS_CA` 可选 mTLS 客户端证书校验
  - 强制 `minVersion=TLSv1.2`、`honorCipherOrder=true`、HSTS 头；证书/密钥文件缺失或不读即拒启动
- **多实例水平扩展 (同机多进程)**: SQLite WAL 多进程并发模型，解单实例写入瓶颈。
  - `busy_timeout=10000` 先于 `journal_mode=WAL` 设置，`BEGIN IMMEDIATE` 抢写锁串行化写事务
  - 迁移锁 `_acquireMigrateLock` + `busy_retry` (60 次重试, Atomics.wait 200ms)，多进程并发启动仅一个跑迁移，其余 BUSY 排队；`SAVEPOINT` 逐迁移回滚，不留半套 schema
  - `FUSION_DOC_ROLE=primary|replica` 角色门控: primary 担单实例职责 (E8 清扫 + 自动备份)，replica 只接请求，防多进程重复执行/惊群；默认 primary (单实例向后兼容)
- **海量知识库 (sqlite-vec ANN)**: `vec0` 虚拟表近似最近邻检索，解向量线性扫规模上限。
  - `rag_chunks.id` 为 TEXT、`vec0` 仅受整数 rowid → 双表桥接 `rag_chunks_vec` (vec0 自增 rowid) + `rag_vec_map` (vec_rowid↔chunk_id)
  - `worker_threads` offload 向量扫描；`AI_EMBEDDING_DIM` (默认 384 = bge-small-en-v1.5) 控制维度；`KNN_OVERSAMPLE=4` 保证权限过滤后取满
  - 扩展加载失败 (无 `vec0.so/.dylib`) 即降级回线性扫，零回归、不阻断启动

### Changed
- `sqlite-vec@0.1.9` + `better-sqlite3@12.11.1` 加入 dependencies (sqlite-vec 经平台 optionalDependencies 解析 `vec0.{so,dylib,dll}`, 走 `db.loadExtension`)
- `scripts/setup.sh` `.env` 模板新增 TLS / 角色 / 维度 / 备份周期配置项 (默认注释)
- `README.md` 新增三段架构修复说明 (内置 TLS / 多实例水平扩展 / 海量知识库)

### Tests
- 新增 14 项行为测试 (36 项全绿): TLS 三态+半配置 fail visibly (5)、vec 降级+KNN 逻辑+双表映射 (4)、迁移锁幂等+SAVEPOINT 回滚+busy_retry+角色门控 (5)

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
