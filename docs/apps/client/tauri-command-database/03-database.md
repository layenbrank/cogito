# 03 — Database：迁移、Entity、CRUD 载荷

Crate：`thinking-database`（`apps/client/src-tauri/crates/database`）。

## 迁移

- **仅注册** [`migrations_v001`](../../../../apps/client/src-tauri/crates/database/src/migrations/migrations_v001.rs)
- 迁移记录表名：`migrations`（非默认 `seaql_migrations`）
- API：`migration::run` / `rollback` / `check`；App 启动时 [`bootstrap.rs`](../../../../apps/client/src-tauri/src/app/bootstrap.rs) 调 `run`，失败即 `expect` panic
- CLI 入口：[`src/bin/migrate.rs`](../../../../apps/client/src-tauri/crates/database/src/bin/migrate.rs)（`sea-orm-migration::cli::run_cli(AppMigrator)`）

### CLI 操作

`-d` 是 **`migrate` 子命令自己的选项**，必须写在 `migrate` **之后**；写成 `sea-orm-cli -d … migrate …` 会被 clap 拒绝（`unexpected argument '-d' found`）。它的用途是让 CLI 定位 `Cargo.toml` 去 `cargo run`，因此传 **crate 根目录**即可，且路径一律用**绝对路径**（相对路径按当前 shell 目录解析，容易拼错）。

```powershell
$dir = "C:\...\apps\client\src-tauri\crates\database"
$db = "$env:LOCALAPPDATA\com.i-thinking.corex\i-thinking.db" -replace '\\', '/'
$url = "sqlite:${db}?mode=rwc" # 必须用 ${db}，写成 "$db?mode=…" 会被 PowerShell 解析坏

sea-orm-cli migrate status -d $dir -u $url # 各迁移 Applied / Pending
sea-orm-cli migrate up -d $dir -u $url # 应用未执行的迁移（已应用则 no-op）
sea-orm-cli migrate down -d $dir -u $url # 回滚 1 步（-n N 回滚 N 步）
sea-orm-cli migrate fresh -d $dir -u $url # 清空全部表后重跑 v001
```

> `-u $url` 用变量传参即可兼容含空格路径，无需再加引号。

| 子命令              | 作用                      | 破坏性                    |
| ------------------- | ------------------------- | ------------------------- |
| `status`            | 打印各迁移的 Applied 状态 | 无                        |
| `up` / `down -n N`  | 应用 / 回滚迁移           | `down` 执行 `down()`，会删表 |
| `reset` / `refresh` | 全部回滚 / 回滚后重跑     | 是                        |
| `fresh`             | 清空全部表后重跑 v001     | 是（等价删库冷启动）      |

- `-u` ↔ `DATABASE_URL`，`-d` ↔ `MIGRATION_DIR`，`-s` ↔ `DATABASE_SCHEMA`（SQLite 忽略）
- CLI 实际执行 `cargo run --manifest-path <dir>/Cargo.toml -- <子命令>`，首次会先编译 `thinking-database`
- 只验证迁移本身：`cargo test -p thinking-database`
- 报 `Migration file of version '…' is missing` 说明库里留存了**已从代码删除**的迁移记录（典型是 v002 / v003）：`up`、`status` 与 App 启动都会失败。重置用 `fresh`，只想保数据可手工删掉 `migrations` 表里那一行。
- 裸跑（不带 `-d` / `-u`）的做法、以及 `init` / `generate` 要求的目录结构，见下方 [CLI 对结构的要求](#cli-对结构的要求)

### CLI 对结构的要求

`status` / `up` / `down` / `reset` / `refresh` / `fresh` **不依赖目录结构**：CLI 只做 `cargo run --manifest-path <MIGRATION_DIR>/Cargo.toml -- <子命令>`，`-d` 默认 `./migration`。所以只需满足三点：

| 要求                                                               | 本仓库                                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------------- |
| `-d` / `MIGRATION_DIR` 指向**含 `Cargo.toml` 的目录**               | `crates/database` ✅                                        |
| 该包能跑出一个把 Migrator 交给 `sea_orm_migration::cli::run_cli` 的 bin | [`src/bin/migrate.rs`](../../../../apps/client/src-tauri/crates/database/src/bin/migrate.rs) ✅ |
| 连接串来自 `-u` 或 `DATABASE_URL`                                   | 按需 ✅                                                     |

不想每次敲参数就设环境变量（实测可用；`MIGRATION_DIR` / `DATABASE_URL` 与 `-d` / `-u` 等价）：

```powershell
$env:MIGRATION_DIR = "C:\...\apps\client\src-tauri\crates\database"
$env:DATABASE_URL = "sqlite:C:/Users/.../i-thinking.db?mode=rwc"
sea-orm-cli migrate fresh # 裸跑
```

> `.env` 文件**不生效**（1.1.19 实测未加载 dotenv），要用环境变量或显式 `-d` / `-u`。

`init`（生成标准布局）/ `generate`（依赖标准布局）才和结构有关：

```text
migration/                              # -d 默认 ./migration
├── Cargo.toml                          # [lib] path = src/lib.rs；默认 bin = src/main.rs
└── src/
    ├── lib.rs                          # prelude::* + mod m20220101_000001_create_table; + Migrator + vec![Box::new(…::Migration)]
    ├── main.rs                         # cli::run_cli(migration::Migrator)
    └── m20220101_000001_create_table.rs
```

`generate` 的落点规则：迁移根取 `-d` 目录下的 `src/`（存在时），注册文件取该根下的 `lib.rs`（优先存在），否则 `mod.rs`；它靠正则插入 `mod m…;`、并替换该文件里**第一个** `vec![…]` 字面量，文件名固定为 `m<YYYYMMDD>_<HHMMSS>_<名字>`（名字不许含 `-`）。

**本仓库不满足该布局**：注册表在 [`src/migration.rs`](../../../../apps/client/src-tauri/crates/database/src/migration.rs)（`AppMigrator`）、迁移在 `src/migrations/`、[`src/lib.rs`](../../../../apps/client/src-tauri/crates/database/src/lib.rs) 是库根，且模块名 `migrations_v001` 不匹配 `m\d{8}_\d{6}_\w+` —— 跑 `generate` 会把文件写到错误位置、并漏改或改坏注册文件。**新增迁移请照 v001 手写**，再在 `AppMigrator::migrations()` 注册。

### 库文件位置

- Windows：`%LOCALAPPDATA%\com.i-thinking.corex\i-thinking.db`（Tauri `app_local_data_dir()/i-thinking.db`，见 [`storage.rs`](../../../../apps/client/src-tauri/crates/database/src/storage.rs)）
- **client 与 studio 共用同一文件**（studio 侧见 [`database.ts`](../../../../apps/studio/src/host/capabilities/database.ts)）：`fresh` 会连 studio 的 `auth` / `chat*` / `workspace*` / `__drizzle_migrations` 一起删；studio 下次启动会重跑自己的迁移（全部 `IF NOT EXISTS` / 条件 `UPDATE`，可安全重跑）。

### v001 表清单

| 表 | Entity 模块 | 备注 |
|----|-------------|------|
| `mirror` | `entity/mirror.rs` | |
| `magneticTile` | `entity/magnetic_tile.rs` | 表名 camelCase |
| `asset` | `entity/asset.rs` | |
| `user` | （无独立 entity 模块） | |
| `notification` | （无） | |
| `comment` | （无） | |
| `countdown` | `entity/countdown.rs` | 含 seed 行 |
| `reminder` | `entity/reminder.rs` | 须先于 calendar（FK） |
| `calendar` | `entity/calendar.rs` | FK → `reminder(id)`，ON DELETE SET NULL |

时间戳统一为 **毫秒**（`timestamp_millis`）。

## Entity 约定

1. `DeriveEntityModel` → `Model` / `ActiveModel` / `Entity` / `Column`
2. JSON：`#[serde(rename_all = "camelCase")]`
3. DB 列：Rust `snake_case` 字段 + `#[sea_orm(column_name = "camelCase")]`
4. 特例：`reminderID` 用显式 `serde(rename)` + `column_name`

## CRUD 参数模式（标准资源）

基数落在 Entity，**不**拆成 `insert-one` / `insert-many` 两条 IPC：

| 类型 | 含义 |
|------|------|
| `Read` / `ReadP` | 查询过滤；`One` \| `Many` |
| `Write` / `WriteP` | 创建（无 id；Service 生成 UUID） |
| `Change` + `Update` / `UpdateP` | 部分更新：`{ key, change }` |
| `RemoveP` | `One(String)` \| `Many(Vec<String>)` |

`WriteP` / `UpdateP` / `ReadP` / `RemoveP` 均为 `#[serde(untagged)]` 的 One/Many。

### Change 可空字段三态

对可清 NULL 的字段使用 `Option<Option<T>>`：

| JSON / Rust | 含义 |
|-------------|------|
| 字段省略 / `None` | 不修改 |
| `null` / `Some(None)` | 清成 NULL |
| 有值 / `Some(Some(v))` | 设为 v |

示例（reminder）：`dueAt`、`fireTime`、`snoozeUntil`、`archivedAt`。

**注意**：前端 TypeScript 里常写成 `dueAt?: number | null`；传给 serde 时「省略」与「显式 null」语义不同——更新时若要清空，需传 `null`；若不想改，不要带该键。

## 审计字段

多数业务表具备：

| 字段 | 含义 |
|------|------|
| `createdAt` | 创建时间（ms） |
| `updatedAt` | 最后更新（ms） |
| `archivedAt` | `NULL` = 活跃；有值 = 终态（完成 / 软删 / 一次性关闭等） |

读接口默认排除已归档（`archived: true` 才包含）。硬删走 `remove`。

## 非标准模块（勿照抄）

| 模块 | 差异 |
|------|------|
| `countdown` | `upsert` / 无统一 `*P`；偏单行配置 |
| `asset` | IPC 可能用 `insert` 而非 `write` |

新增「列表型业务资源」时，优先对齐 reminder / calendar / mirror / magnetic-tile 的 WriteP 模式。

## Reminder / Calendar 字段速查

完整语义见 [05-reminder-calendar.md](./05-reminder-calendar.md)。Entity 源码：

- [`entity/reminder.rs`](../../../../apps/client/src-tauri/crates/database/src/entity/reminder.rs)
- [`entity/calendar.rs`](../../../../apps/client/src-tauri/crates/database/src/entity/calendar.rs)
