# =============================================================================
# Fusion-Doc — 生产部署镜像 (issue #41)
# 多阶段: build 阶段 (带编译工具链) 编译 native + 客户端 → 运行阶段仅复制产物, 无工具链 (瘦镜像)。
# 零外部依赖 (无 PostgreSQL/Redis), 仅需持久卷挂 /app/data。
#
# better-sqlite3: linux/arm64 node-20 无预编译二进制 → node-gyp 源码编译 (需 python3 make g++)。
#   故 build 阶段装工具链, 编译后把 node_modules 整体拷进 runtime, runtime 不再 npm ci (无需工具链)。
# sqlite-vec: 经 optionalDependencies 解析 sqlite-vec-linux-arm64/vec0.so (预编译, 无需编译),
#   随 node_modules 一起拷进 runtime, db.loadExtension 加载。
# =============================================================================
FROM node:20-slim AS build
WORKDIR /app

# ── native 编译工具链 (better-sqlite3 node-gyp; 用完即弃, 不进 runtime) ──
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# ── 根依赖 (server runtime deps: better-sqlite3 编译 / sqlite-vec / ws) ──
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── 客户端依赖 (vite 在 client devDependencies, 构建需先装) ──
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci

# ── 源码 + 构建 (产物落 gateway/public/, 由 vite.config.js outDir 决定) ──
COPY . .
RUN npm run build

# ── 瘦身: 删 native 编译中间产物, 仅留 Release/better_sqlite3.node (~2MB) + lib/ ──
# obj/obj.target/.deps/sqlite3.a/test_extension.node/Makefile/config.gypi 均编译垃圾, runtime 不用
RUN cd node_modules/better-sqlite3 \
    && rm -rf build/Release/obj build/Release/obj.target build/Release/.deps \
           build/Release/sqlite3.a build/Release/test_extension.node \
           build/obj build/obj.target build/deps build/Makefile build/*.mk build/*.gypi build/binding.Makefile \
           src deps *.gyp *.md *.ts \
    && cd /app \
    && rm -rf node_modules/prebuild-install node_modules/node-gyp node_modules/tar-fs \
           node_modules/rc node_modules/github-from-package

# =============================================================================
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV FUSION_DOC_PORT=11449
ENV FUSION_DOC_HOST=0.0.0.0

# ── 产物: server + 客户端构建输出 + 品牌 + 已编译 node_modules + package.json ──
# node_modules 含 better-sqlite3 编译产物 + sqlite-vec .so, runtime 无需工具链
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/gateway/public ./gateway/public
COPY --from=build /app/branding ./branding
COPY --from=build /app/package.json ./package.json

# ── 持久卷: SQLite DB / 上传 / 导出 / 版本 / 日志 (db.js 自动建子目录) ──
VOLUME ["/app/data"]

EXPOSE 11449

# 生产须注入: JWT_SECRET (production fail-fast), FUSION_MLX_API_KEY (AI 调用; 缺则 health degraded)
# 容器连宿主 MLX: FUSION_MLX_URL=http://host.docker.internal:11434 (+ docker run --add-host=host.docker.internal:host-gateway)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:11449/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
