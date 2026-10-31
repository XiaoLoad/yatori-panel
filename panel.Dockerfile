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
COPY --from=deps /app .
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY --from=build-web /app/apps/web/dist apps/web/dist
EXPOSE 8080
CMD ["node", "apps/server/src/index.ts"]
