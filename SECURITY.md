# 安全策略 (Security Policy)

## 报告漏洞

如发现安全漏洞，请**勿**在公开 Issue 中提交。

请通过以下方式私下报告：
- GitHub Security Advisory: 仓库 → Security → Report a vulnerability
- 邮件: 安全负责人 (见仓库 Maintainers)

报告时请包含：影响范围、复现步骤、建议修复方向。我们将在 **5 个工作日内**确认收悉，并在修复发布后致谢。

## 支持版本

| 版本 | 状态 |
|------|------|
| 1.0.x | ✅ 安全维护 |

## 安全特性

### 认证与密码
- **密码哈希**: scrypt 慢哈希 (N=2^15, r=8, p=1, keyLen=64B)，抗离线爆破
- **向后兼容**: 旧版 HMAC-SHA256 哈希在用户登录时自动透明升级到 scrypt
- **JWT**: HS256 签名，生产环境强制要求 `JWT_SECRET` 环境变量 (缺失则启动 fail-fast)
- **会话有效期**: 默认 24h，可通过 `SESSION_EXPIRY` 配置

### 访问控制
- **限流**: 认证端点 `/api/auth/*` 10 次/分钟，其余 API 120 次/分钟 (内存计数，防爆破)
- **管理员权限**: 系统管理接口 (备份等) 强制 `role === 'admin'` 校验
- **开发模式旁路**: `NODE_ENV=development` + `X-User-Id` 头仅限开发环境，生产环境无效

### 网络
- **绑定地址**: 生产环境默认 `127.0.0.1` (仅本机)，显式 `FUSION_DOC_HOST=0.0.0.0` 才暴露
- **TLS**: 服务本身仅 HTTP，商用部署须前置反向代理 (Nginx/Caddy) 终结 TLS
- **CORS**: 生产环境默认仅允许本机来源，通过 `CORS_ORIGINS` 配置白名单

### 数据
- **SQL 注入**: 全部使用参数化查询 (`prepare().run()`)，无字符串拼接
- **SQLite**: WAL 模式 + foreign_keys + busy_timeout，数据可靠性保障
- **备份**: 在线热备 (WAL 一致性快照)，支持 API 触发与 cron 定时

### AI 密钥
- **FUSION_MLX_API_KEY**: 仅从环境变量读取，禁止字面量硬编码
- **fail visibly**: 密钥缺失时调用直接抛错，不静默放行

## 生产部署清单

```bash
# 1. 必需环境变量
export JWT_SECRET="$(openssl rand -hex 32)"      # JWT 签名密钥 (必需)
export FUSION_MLX_API_KEY="..."                  # Fusion-MLX 调用密钥 (必需)
export NODE_ENV="production"                     # 生产模式
export FUSION_DOC_HOST="127.0.0.1"               # 仅本机 (默认; 前置反代时用 0.0.0.0)

# 2. 可选加固
export CORS_ORIGINS="https://your-domain.com"    # CORS 白名单
export SESSION_EXPIRY="86400"                    # 会话有效期 (秒)

# 3. 定时备份 (crontab)
0 2 * * * cd /path/to/fusion-doc && bash scripts/backup.sh 30
```

### 反向代理 + TLS (示例: Caddy)

```
your-domain.com {
  reverse_proxy 127.0.0.1:11449
}
```

## 已知限制

- 限流为内存计数 (单实例)，多实例部署需换 Redis 后端
- 无内置 HTTPS，依赖前置反代
- 无单点登录 (SSO) 集成，仅本地账号体系
