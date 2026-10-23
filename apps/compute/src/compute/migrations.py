"""迁移：按文件名顺序执行 `sql/NNNN_*.sql`，并在 `schema_migration` 里记账。

为什么不用 Alembic：这里只有「建扩展 + 建自己那几张表」，没有需要回滚的数据迁移，
也不需要跨多套 DSN 的版本图。一个 40 行的执行器可读性更好，也不用为 ORM 生态引入一整套依赖。

并发安全：多副本同时启动时，先在同一事务里抢一把 advisory 锁再建 `schema_migration` 表，
否则两边的 `CREATE TABLE IF NOT EXISTS` 会撞在同一个系统目录上。
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path

from asyncpg import Connection

logger = logging.getLogger(__name__)

#: `sql/` 与包一起分发（见 pyproject 的 hatch 配置）。
MIGRATIONS_DIR = Path(__file__).resolve().parent / "sql"

#: 固定值的 advisory lock key，`hex("compute")`，仅本服务使用。
_ADVISORY_LOCK_KEY = 0x636F6D70757465

_CREATE_LEDGER = """
CREATE TABLE IF NOT EXISTS schema_migration (
    version    text        PRIMARY KEY,
    checksum   text        NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
)
"""


@dataclass(frozen=True, slots=True)
class Migration:
    version: str
    path: Path
    sql: str

    @property
    def checksum(self) -> str:
        return hashlib.sha256(self.sql.encode("utf-8")).hexdigest()


def load_migrations(directory: Path = MIGRATIONS_DIR) -> list[Migration]:
    """读目录下所有 `*.sql`，按文件名排序。"""
    if not directory.is_dir():
        message = f"迁移目录不存在：{directory}"
        raise FileNotFoundError(message)
    migrations: list[Migration] = []
    for path in sorted(directory.glob("*.sql")):
        sql = path.read_text(encoding="utf-8")
        if not sql.strip():
            continue
        migrations.append(Migration(version=path.stem, path=path, sql=sql))
    return migrations


async def apply(connection: Connection, migrations: list[Migration]) -> list[Migration]:
    """执行未应用的迁移，返回本次实际应用的列表。已应用的迁移会校验校验和。"""
    applied: list[Migration] = []
    async with connection.transaction():
        await connection.execute("SELECT pg_advisory_xact_lock($1)", _ADVISORY_LOCK_KEY)
        await connection.execute(_CREATE_LEDGER)
        rows = await connection.fetch("SELECT version, checksum FROM schema_migration")
        recorded = {row["version"]: row["checksum"] for row in rows}

        for migration in migrations:
            previous = recorded.get(migration.version)
            if previous is not None:
                if previous != migration.checksum:
                    message = (
                        f"迁移 {migration.version} 的内容与已应用的版本不一致："
                        "已应用过的迁移视作不可变，请新增一个迁移文件"
                    )
                    raise RuntimeError(message)
                continue
            logger.info("应用迁移 %s", migration.version)
            await connection.execute(migration.sql)
            await connection.execute(
                "INSERT INTO schema_migration (version, checksum) VALUES ($1, $2)",
                migration.version,
                migration.checksum,
            )
            applied.append(migration)

    return applied
