# agentd（Node / rolldown bundle）镜像：LangGraph 编排层侧车。
#
# **桌面端永远走 Tauri sidecar，不用这个镜像**（ADR 不变量 5：agentd 被 Tauri 收养进 Job Object）。
# 这个镜像只服务 CI 与「容器里验证 Agent Protocol」这一种用途：容器内没有 goose 二进制，
# 所以**刻意不配 `AGENTD_GOOSE_PATH_ROOT`** —— `/health` 的 `goose` 字段会是 `disabled`
# （意图是「不托管」），而不是 `failed`（配了路径但找不到二进制）。
# 图启动、线程、审批、事件流、持久化、鉴权都能验，唯独真正跑模型需要在外部另起 goose。
#
# 构建（**上下文必须是仓库根**：agentd 依赖 workspace 内的 `@cogito/agent-protocol`）：
#   docker compose build cogito-agentd
#   docker build -t cogito-agentd:local -f docker/agentd/Dockerfile .
#
# 需要 BuildKit（Docker 默认已开）：pnpm store 走 cache mount。

# syntax=docker/dockerfile:1.7

# ------------------------------- 构建段 -------------------------------
FROM node:24.18-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

# pnpm 的主版本必须与根 package.json 的 `packageManager` 一致，
# 否则 `--frozen-lockfile` 会因 lockfileVersion / settings 差异直接拒绝。
RUN corepack enable && corepack prepare pnpm@12.10.1 --activate

WORKDIR /repo

# 上下文根的 .dockerignore 已排除 node_modules / target / dist，这一层不会拖构建产物。
COPY . .

# 用**全量** install 而不是 `--filter @cogito/agentd...`：
# pnpm 的 `--frozen-lockfile` 会拿 workspace 里实际存在的成员去对 lockfile，
# 只拷部分成员时必定报「lockfile is not up to date」，而 workspace 成员的 package.json
# 散在十几个目录，逐个 COPY 既脆弱又难维护。这里 `COPY . .` 已经拿到全部清单，
# 全量装与 CI 的 `pnpm install --frozen-lockfile` 完全同形，可复现性更好。
#
# `--ignore-scripts` 是必须的：仓库里有 `preinstall: only-allow pnpm`（会 npx 联网）、
# `prepare: husky`（容器里没有 .git）、以及某个 app 的 `postinstall: electron-rebuild`
# （要下 electron 头文件、还依赖宿主平台）。agentd 的依赖全是纯 JS，
# rolldown 打包时不需要任何 install 脚本产物。
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

RUN pnpm --filter @cogito/agentd build && test -s apps/agentd/dist/main.cjs

# ------------------------------- 运行段 -------------------------------
FROM node:24.18-bookworm-slim AS runtime

# curl 只给 compose 的 healthcheck 用（`/health` 免鉴权）。
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 app

# rolldown 的输出是自包含 CJS（依赖全在 bundle 里）：运行段不需要 node_modules，
# 也不需要 SEA —— SEA 只是为了让「机器上没有 node」的用户也能双击跑，容器里本来就有 node。
COPY --from=builder --chown=app:app /repo/apps/agentd/dist/main.cjs /app/main.cjs

# 数据目录（`agentd.db` 与 goose 的 config/secrets）由 compose 卷挂进来
RUN mkdir -p /data && chown app:app /data

WORKDIR /app
USER app

# 容器里必须固定端口；桌面端才用 0（由内核挑空闲端口，避开本机 1024–15000 动态段）。
ENV AGENTD_PORT=8080 \
    AGENTD_DB=/data/agentd.db

EXPOSE 8080

# AGENTD_TOKEN 必填（fail-closed，缺失直接退出）—— compose 里用 ${AGENTD_TOKEN:?…} 兜住
CMD ["node", "main.cjs"]
