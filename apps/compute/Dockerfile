# compute（Python / FastAPI）：cogito 的叶子计算服务，RAG 摄取与 agent 运行时。
#
# 企业级约定与 Rust 镜像相同：**构建机**打出不可变 OCI 镜像，**生产机**只 pull 运行，
# 绝不在容器启动时 pip/uv install。依赖由 uv.lock 锁死，装进镜像层的 .venv。
#
# 构建（上下文必须是 apps/compute）：
#   docker compose build compute
#   docker build -t cogito-compute:local -f Dockerfile .
#
# Python 3.12 是硬约束（pyproject 的 requires-python 是 >=3.12,<3.13）。
# 需要 BuildKit：uv 包缓存走 cache mount。

# syntax=docker/dockerfile:1.7

# ------------------------------- 构建段 -------------------------------
FROM python:3.12-slim-bookworm AS builder

COPY --from=ghcr.io/astral-sh/uv:0.13.4 /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# 依赖层先于源码层：改业务代码不会让依赖层缓存失效。
# README.md 要一起给，hatchling 构建项目元数据时会读它（readme = "README.md"）。
COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# src/compute/sql/*.sql 随 wheel 进 site-packages（migrations.py 按包路径读）。
# --no-editable：代码进 site-packages，runtime 不必再 COPY src/，也不必留 uv。
COPY src/ ./src/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

# ------------------------------- 运行段 -------------------------------
FROM python:3.12-slim-bookworm AS runtime

# curl 只给 compose 的 healthcheck 用（/internal/v1/health）。
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH=/app/.venv/bin:$PATH

WORKDIR /app

COPY --from=builder --chown=app:app /app/.venv /app/.venv

USER app

EXPOSE 8081
CMD ["compute"]
