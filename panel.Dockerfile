# 依赖安装与前端构建都在 Linux 容器内完成，保证 esbuild 等平台二进制与运行时一致
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS build-web
WORKDIR /app
COPY --from=deps /app .
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN cd apps/web && bunx vite build

# 运行时用 Node 24：node:sqlite（面板数据库）与原生 TS 直接执行
FROM node:24-bookworm-slim
WORKDIR /app
# 容器默认 UTC：定时规则按东八区解释（与 PANEL_TIMEZONE 默认值一致，避免 cron 偏移 8 小时）
ENV TZ=Asia/Shanghai
COPY --from=deps /app .
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY --from=build-web /app/apps/web/dist apps/web/dist
EXPOSE 8080
# 面板进程存活探针：挂起/假死时由 Docker 自动重启（网关离线不影响面板健康）
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/src/index.ts"]
