# =============================================================================
# Fusion-Doc — 生产部署镜像 (P2-O4 修复)
# 原无容器化交付件。多阶段: build 阶段编译客户端 → 运行阶段仅含 node + 产物。
# 零外部依赖 (无 PostgreSQL/Redis), 仅需持久卷挂 /app/data。
# =============================================================================
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV FUSION_DOC_PORT=11449
ENV FUSION_DOC_HOST=0.0.0.0
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server ./server
COPY --from=build /app/gateway/public ./gateway/public
COPY --from=build /app/branding ./branding
COPY --from=build /app/package.json ./package.json
VOLUME ["/app/data"]
EXPOSE 11449
# 生产须注入: JWT_SECRET, FUSION_MLX_API_KEY (见 SECURITY.md)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:11449/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
