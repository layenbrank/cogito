"""库边界：compute 的库里只能有它自己的表；连不上时不许把进程带崩。

第一条是这次拆分的核心约束——cogito 的业务表出现在这里，就说明「共用一套库」这条捷径
又被人走通了，之后两边的迁移会互相踩。第二条是可用性选择：**降级运行**比
CrashLoopBackOff 更好排查（配置改对后不用重启容器，探针自己会重连）。
"""

from __future__ import annotations

import pytest
from pgvector import Vector

from compute.db import Database, DatabaseUnavailableError
from support import OWNED_TABLES, UNREACHABLE_DATABASE_URL, make_settings

OWN_TABLES = {"schema_migration", *OWNED_TABLES}


async def test_database_contains_only_compute_owned_tables(database: Database) -> None:
    async with database.acquire() as connection:
        rows = await connection.fetch("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")

    tables = {row["tablename"] for row in rows}
    assert tables == OWN_TABLES, f"库中出现了不属于 compute 的表：{sorted(tables - OWN_TABLES)}"


async def test_unstarted_database_refuses_to_hand_out_connections() -> None:
    database = Database(make_settings())

    with pytest.raises(DatabaseUnavailableError):
        async with database.acquire():
            pass


async def test_start_swallows_connection_failures() -> None:
    settings = make_settings(
        database_url=UNREACHABLE_DATABASE_URL,
        db_connect_timeout_seconds=1.0,
        db_reconnect_interval_seconds=30.0,
    )
    database = Database(settings)

    await database.start()  # 关键：不抛异常

    assert database.started is False
    assert database.last_error is not None
    probe = await database.probe()
    assert probe.ok is False
    assert probe.database is False
    await database.close()


async def test_start_is_idempotent(database: Database) -> None:
    await database.start()
    await database.start()

    assert database.started is True
    assert database.last_error is None


async def test_probe_reports_database_and_pgvector(database: Database) -> None:
    probe = await database.probe()

    assert probe.ok is True
    assert probe.database is True
    assert probe.pgvector is True
    assert probe.detail == ""


async def test_pool_connections_decode_vectors(database: Database) -> None:
    """池的 `init=register_vector` 生效了才有 P6b-4：否则读回来只是一串文本。"""
    async with database.acquire() as connection:
        value = await connection.fetchval("SELECT '[1,2,3]'::vector")

    assert isinstance(value, Vector)
    assert value.to_list() == [1.0, 2.0, 3.0]
