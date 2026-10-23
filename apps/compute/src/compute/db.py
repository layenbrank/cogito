"""数据库：连接池 + 启动期的迁移 + 健康探针。

启动分两步，顺序不能反：

1. 先用 `asyncpg.connect()` 直连（**不经过池**）跑迁移 —— 迁移会 `CREATE EXTENSION vector`，
   而池的 `init=register_vector` 需要扩展已经存在；
2. 再 `create_pool(..., init=...)`，每个新连接都注册 `vector` 类型编解码器。

**连不上不抛异常**：进程照常起来，`/internal/v1/health` 回 503 `degraded`。
配置错（错密码、库不存在）修好之后容器不需要重启就能自愈，比 CrashLoopBackOff 好排查。
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

import asyncpg
import pgvector.asyncpg
from asyncpg import Connection, Pool

from compute.config import Settings
from compute.migrations import MIGRATIONS_DIR, Migration, apply, load_migrations

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ProbeResult:
    """探针结果。`detail` 只进日志，绝不进响应体。"""

    database: bool
    pgvector: bool
    detail: str = ""

    @property
    def ok(self) -> bool:
        return self.database and self.pgvector


async def _init_connection(connection: Connection) -> None:
    await pgvector.asyncpg.register_vector(connection)


class Database:
    """惰性启动的池；启动失败只记录原因，由探针触发重试。"""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._pool: Pool | None = None
        self._lock = asyncio.Lock()
        self._last_error: str | None = None
        self._last_attempt: float = 0.0
        self._last_migrations: list[Migration] = []

    @property
    def last_error(self) -> str | None:
        """最近一次启动失败的原因（None 表示上次启动成功）。测试据此跳过仍缺 pgvector 的环境。"""
        return self._last_error

    @property
    def last_migrations(self) -> list[Migration]:
        return list(self._last_migrations)

    @property
    def started(self) -> bool:
        return self._pool is not None

    async def start(self) -> None:
        """幂等；不抛异常。成功时把 `last_error` 清空。"""
        if self._pool is not None:
            return
        async with self._lock:
            await self._open_if_needed()

    async def _open_if_needed(self) -> None:
        """真正建池；调用方持锁。并发的第二个调用者会走到这里并直接返回。"""
        if self._pool is not None:
            return
        try:
            self._pool = await self._open_pool()
        except Exception as exc:  # 任何失败都只降级，不终止进程
            self._last_error = f"{type(exc).__name__}: {exc}"
            self._last_attempt = time.monotonic()
            logger.error("数据库不可用，服务以降级状态运行：%s", self._last_error)
        else:
            self._last_error = None
            logger.info("数据库已就绪")

    async def _open_pool(self) -> Pool:
        settings = self._settings
        connection = await asyncpg.connect(
            dsn=settings.database_url,
            timeout=settings.db_connect_timeout_seconds,
        )
        try:
            self._last_migrations = await apply(connection, load_migrations(MIGRATIONS_DIR))
        finally:
            await connection.close()

        return await asyncpg.create_pool(
            dsn=settings.database_url,
            min_size=settings.db_pool_min_size,
            max_size=settings.db_pool_max_size,
            timeout=settings.db_connect_timeout_seconds,
            command_timeout=settings.db_command_timeout_seconds,
            init=_init_connection,
        )

    async def probe(self) -> ProbeResult:
        """探一次；上次启动失败且已过节流间隔就顺手重试一次启动。"""
        if self._pool is None and self._should_retry():
            await self.start()
        if self._pool is None:
            return ProbeResult(database=False, pgvector=False, detail=self._last_error or "未启动")

        try:
            async with self._pool.acquire() as connection:
                await connection.execute("SELECT 1")
                has_vector = await connection.fetchval(
                    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')"
                )
        except Exception as exc:  # 探针只回答「能不能用」
            return ProbeResult(
                database=False, pgvector=False, detail=f"{type(exc).__name__}: {exc}"
            )

        return ProbeResult(
            database=True,
            pgvector=bool(has_vector),
            detail="" if has_vector else "未安装 vector 扩展（迁移未执行？）",
        )

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[Connection]:
        """拿一条连接；池没起来就抛 `RuntimeError`（由调用方转成 503）。"""
        pool = self._pool
        if pool is None:
            message = f"数据库连接池不可用：{self._last_error or '未启动'}"
            raise DatabaseUnavailableError(message)
        async with pool.acquire() as connection:
            yield connection

    async def close(self) -> None:
        pool, self._pool = self._pool, None
        if pool is not None:
            await pool.close()

    def _should_retry(self) -> bool:
        return (
            time.monotonic() - self._last_attempt
        ) >= self._settings.db_reconnect_interval_seconds


class DatabaseUnavailableError(RuntimeError):
    """池没起来。路由层统一映射成 503 `dependency_unavailable`。"""
