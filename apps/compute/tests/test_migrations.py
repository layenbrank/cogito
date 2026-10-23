"""迁移执行器：内容不可变、重复执行安全、并发启动靠 advisory lock 排队。"""

from __future__ import annotations

from pathlib import Path

import pytest

from compute.db import Database
from compute.migrations import MIGRATIONS_DIR, Migration, apply, load_migrations


def test_migrations_directory_ships_with_the_package() -> None:
    assert MIGRATIONS_DIR.is_dir()
    assert MIGRATIONS_DIR.name == "sql"


def test_load_migrations_is_sorted_and_skips_blank_files(tmp_path: Path) -> None:
    (tmp_path / "0002_b.sql").write_text("SELECT 2", encoding="utf-8")
    (tmp_path / "0001_a.sql").write_text("SELECT 1", encoding="utf-8")
    (tmp_path / "0003_blank.sql").write_text("   \n", encoding="utf-8")

    versions = [migration.version for migration in load_migrations(tmp_path)]

    assert versions == ["0001_a", "0002_b"]


def test_load_migrations_rejects_a_missing_directory(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        load_migrations(tmp_path / "nope")


def test_migration_checksum_follows_content(tmp_path: Path) -> None:
    first = Migration(version="0001", path=tmp_path / "0001.sql", sql="SELECT 1")
    second = Migration(version="0001", path=tmp_path / "0001.sql", sql="SELECT 2")

    assert first.checksum != second.checksum


async def test_schema_ledger_records_the_bundled_migrations(database: Database) -> None:
    async with database.acquire() as connection:
        rows = await connection.fetch("SELECT version, checksum FROM schema_migration")

    recorded = {row["version"]: row["checksum"] for row in rows}
    bundled = {migration.version: migration.checksum for migration in load_migrations()}
    assert bundled != {}
    assert set(bundled) <= set(recorded)
    assert recorded["0001_init"] == bundled["0001_init"]


async def test_reapplying_the_same_migrations_is_a_noop(database: Database) -> None:
    async with database.acquire() as connection:
        applied = await apply(connection, load_migrations())

    assert applied == []


async def test_modified_migration_is_rejected(database: Database) -> None:
    """已应用的迁移视作不可变：改内容必须新增文件，而不是就地编辑。"""
    original = load_migrations()[0]
    tampered = Migration(version=original.version, path=original.path, sql="SELECT 'tampered'")

    async with database.acquire() as connection:
        with pytest.raises(RuntimeError):
            await apply(connection, [tampered])


async def test_pgvector_extension_is_installed(database: Database) -> None:
    """`0001_init.sql` 的第一句就是它；缺了它 P6b-4 的向量列无从谈起。"""
    async with database.acquire() as connection:
        installed = await connection.fetchval(
            "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')"
        )

    assert installed is True
