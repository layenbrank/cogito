"""测试夹具。

两套应用：`app` 带真实数据库（需要本地 pgvector 容器，否则整组 skip），
`offline_app` 带一个连不上的数据库——中间件、降级、错误码这些不需要库的用例都在它上面跑。
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from compute.app import create_app
from compute.cogito_client import CogitoClient
from compute.config import Settings
from compute.db import Database
from routes import router
from support import (
    OWNED_TABLES,
    UNREACHABLE_DATABASE_URL,
    CogitoHandler,
    HandlerClient,
    MakeCogito,
    make_settings,
)


@pytest.fixture(scope="session")
def settings() -> Settings:
    return make_settings()


@pytest_asyncio.fixture
async def database(settings: Settings) -> AsyncIterator[Database]:
    db = Database(settings)
    await db.start()
    try:
        if not db.started:
            pytest.skip(f"测试数据库不可用，先起 pgvector 容器：{db.last_error}")
        probe = await db.probe()
        if not probe.ok:
            pytest.skip(f"测试数据库不可用：{probe.detail}")
        async with db.acquire() as conn:
            # 每个用例都从空表开始：`rag_chunk` 有外键，顺序按 support.OWNED_TABLES 来。
            # 表名是模块常量（不是用户输入），这里用 f-string 拼是安全的。
            for table in OWNED_TABLES:
                await conn.execute(f"DELETE FROM {table}")  # noqa: S608 - 表名来自常量白名单
        yield db
    finally:
        await db.close()


@pytest_asyncio.fixture
async def app(settings: Settings, database: Database) -> AsyncIterator[FastAPI]:
    application = create_app(settings, database=database)
    application.include_router(router)
    yield application


@pytest_asyncio.fixture
async def offline_app() -> AsyncIterator[FastAPI]:
    settings = make_settings(
        database_url=UNREACHABLE_DATABASE_URL,
        db_command_timeout_seconds=0.5,
        # 探针节流设大一点：连不上时的重试日志没必要刷满测试输出。
        db_reconnect_interval_seconds=30.0,
    )
    application = create_app(settings, database=Database(settings))
    application.include_router(router)
    yield application


@pytest_asyncio.fixture
async def bare_app(settings: Settings) -> FastAPI:
    """不含测试路由的应用：路由面断言必须只看真实路由。"""
    return create_app(settings, database=Database(settings))


@pytest_asyncio.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://compute.test") as c:
        yield c


@pytest_asyncio.fixture
async def offline_client(offline_app: FastAPI) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=offline_app)
    async with AsyncClient(transport=transport, base_url="http://compute.test") as c:
        yield c


@pytest_asyncio.fixture
async def make_cogito() -> AsyncIterator[MakeCogito]:
    """用 `httpx.MockTransport` 造 CogitoClient，并在用例结束后统一关掉连接。"""
    created: list[CogitoClient] = []

    def factory(
        handler: Callable[[httpx.Request], httpx.Response], **overrides: object
    ) -> CogitoClient:
        client = CogitoClient(make_settings(**overrides), transport=httpx.MockTransport(handler))
        created.append(client)
        return client

    yield factory
    for client in created:
        await client.close()


@pytest_asyncio.fixture
async def cogito_backed_client(
    database: Database, make_cogito: MakeCogito
) -> AsyncIterator[HandlerClient]:
    """造一个「真库 + 假 cogito」的客户端：RAG 端点两头都要碰，缺哪一头都测不下去。

    cogito 用 `create_app(..., cogito=...)` 的注入点替换成桩，所以这里的 handler 就是
    「cogito 怎么回」的剧本；`overrides` 同时作用于应用配置与 cogito 客户端配置。
    """
    created: list[AsyncClient] = []

    def factory(handler: CogitoHandler, **overrides: object) -> AsyncClient:
        settings = make_settings(**overrides)
        application = create_app(
            settings, database=database, cogito=make_cogito(handler, **overrides)
        )
        application.include_router(router)
        client = AsyncClient(
            transport=ASGITransport(app=application), base_url="http://compute.test"
        )
        created.append(client)
        return client

    yield factory
    for client in created:
        await client.aclose()
