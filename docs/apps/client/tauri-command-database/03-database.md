# 03 — Database：迁移、Entity、CRUD 载荷

Crate：`cogito-database`（`apps/client/src-tauri/crates/database`）。

## 迁移

- 已注册 [`migrations_v001`](../../../../apps/client/src-tauri/crates/database/src/migrations/migrations_v001.rs)（全量基线）与 [`migrations_v002`](../../../../apps/client/src-tauri/crates/database/src/migrations/migrations_v002.rs)（捕获库 `album` 表）
- 迁移记录表名：`migrations`（非默认 `seaql_migrations`）
- API：`migration::run` / `rollback` / `check`；App 启动时 [`bootstrap.rs`](../../../../apps/client/src-tauri/src/app/bootstrap.rs) 调 `run`，失败即 `expect` panic
- CLI 入口：[`src/bin/migrate.rs`](../../../../apps/client/src-tauri/crates/database/src/bin/migrate.rs)（`sea-orm-migration::cli::run_cli(AppMigrator)`）

### 执行迁移（`migrate:*` 脚本）

统一走 [`scripts/migrate.ts`](../../../../apps/client/scripts/migrate.ts)：它自己解析库路径并调用迁移 bin，**不再需要 `sea-orm-cli` 与 `-d` / `-u`**。

```powershell
pnpm --filter @cogito/client migrate:status # 各迁移 Applied / Pending
pnpm --filter @cogito/client migrate:up # 应用未执行的迁移（已应用则 no-op）
pnpm --filter @cogito/client migrate:down # 回滚 1 步（透传：… migrate down -- -n 2）
pnpm --filter @cogito/client migrate:fresh # 清空全部表后重跑全部迁移
```

库路径默认取 `%LOCALAPPDATA%\com.cogito.client\cogito-client.db`（其他平台为各自的应用数据目录），可用 `--db <路径>` 或环境变量 `COGITO_CLIENT_DB` 覆盖；`migrate` 不带子命令时等价于 `migrate:status`；`--no-backup` 跳过备份；`--` 之后的参数原样透传给 bin（如 `-n 2`）。

**破坏性子命令自动备份**：`fresh` / `reset` / `refresh` 执行前会把库文件（含 `-wal` / `-shm`）复制为同目录的 `cogito-client.db.<时间戳>.bak*`，并提示先完全退出应用（库被占用时会报错）。

| 子命令              | 作用                      | 破坏性                       |
| ------------------- | ------------------------- | ---------------------------- |
| `status`            | 打印各迁移的 Applied 状态 | 无                           |
| `up` / `down -n N`  | 应用 / 回滚迁移           | `down` 执行 `down()`，会删表 |
| `reset` / `refresh` | 全部回滚 / 回滚后重跑     | 是                           |
| `fresh`             | 清空全部表后重跑全部迁移  | 是（等价删库冷启动）         |

- 脚本实际执行 `cargo run --manifest-path src-tauri/Cargo.toml -p cogito-database --bin cogito-database -- -u <url> <子命令>`，首次会先编译 `cogito-database`
- 手敲 bin 时的等价变量：`-u` ↔ `DATABASE_URL`，`-s` ↔ `DATABASE_SCHEMA`（SQLite 忽略）
- 只验证迁移本身：`cargo test -p cogito-database`
- 报 `Migration file of version '…' is missing` 说明库里留存了**已从代码删除**的迁移记录（典型是旧世代的 v002 / v003）：`up`、`status` 与 App 启动都会失败。重置用 `migrate:fresh`（会先自动备份），只想保数据可手工删掉 `migrations` 表里那一行。

### 为什么不用 `sea-orm-cli`

`src-tauri` 现在是 Cargo **workspace**（根 `Cargo.toml` 的 `members = [".", "crates/database", "crates/core", "crates/command"]`），而 `sea-orm-cli migrate … -d <dir>` 那套的前提是「`-d` 指向一个能 `cargo run` 的 crate 根」—— 结构变了之后这条链路不再可用，因此统一走上面的 `migrate:*` 脚本。

迁移 bin 仍是 [`src/bin/migrate.rs`](../../../../apps/client/src-tauri/crates/database/src/bin/migrate.rs)（`sea_orm_migration::cli::run_cli(AppMigrator)`），`-u` 是它的**顶层**选项，要写在子命令之前；`DATABASE_URL` 环境变量同样被识别（`MIGRATION_DIR` 已无意义 —— 不再有 `-d` 定位这一步）。

> `.env` 文件**不生效**（1.1.19 实测未加载 dotenv），要用环境变量或脚本参数。

只有 `init`（生成标准布局）/ `generate`（依赖标准布局）才和目录结构有关（本仓库两者都不用）：

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

- Windows：`%LOCALAPPDATA%\com.cogito.client\cogito-client.db`（Tauri `app_local_data_dir()/cogito-client.db`，见 [`storage.rs`](../../../../apps/client/src-tauri/crates/database/src/storage.rs)）
- **client 与 studio 共用同一文件**（studio 侧见 [`database.ts`](../../../../apps/studio/src/host/capabilities/database.ts)）：`fresh` 会连 studio 的 `auth` / `chat*` / `workspace*` / `__drizzle_migrations` 一起删；studio 下次启动会重跑自己的迁移（全部 `IF NOT EXISTS` / 条件 `UPDATE`，可安全重跑）。`migrate:fresh` 会先自动备份，但恢复仍需手工做。

### v001 表清单

| 表             | Entity 模块               | 备注                                    |
| -------------- | ------------------------- | --------------------------------------- |
| `mirror`       | `entity/mirror.rs`        |                                         |
| `magneticTile` | `entity/magnetic_tile.rs` | 表名 camelCase                          |
| `asset`        | `entity/asset.rs`         |                                         |
| `user`         | （无独立 entity 模块）    |                                         |
| `notification` | （无）                    |                                         |
| `comment`      | （无）                    |                                         |
| `countdown`    | `entity/countdown.rs`     | 含 seed 行                              |
| `reminder`     | `entity/reminder.rs`      | 须先于 calendar（FK）                   |
| `calendar`     | `entity/calendar.rs`      | FK → `reminder(id)`，ON DELETE SET NULL |

时间戳统一为 **毫秒**（`timestamp_millis`）。

### v002 表清单

| 表      | Entity 模块       | 备注                                                                               |
| ------- | ----------------- | ---------------------------------------------------------------------------------- |
| `album` | `entity/album.rs` | 捕获库相簿定义（名称 / 顺序 / 封面）；**无外键**，成员存在 `asset.metadata.albums` |

新增迁移一律照 v001 / v002 **手写**，再在 `AppMigrator::migrations()` 注册。

## Entity 约定

1. `DeriveEntityModel` → `Model` / `ActiveModel` / `Entity` / `Column`
2. JSON：`#[serde(rename_all = "camelCase")]`
3. DB 列：Rust `snake_case` 字段 + `#[sea_orm(column_name = "camelCase")]`
4. 特例：`reminderID` 用显式 `serde(rename)` + `column_name`

## CRUD 参数模式（标准资源）

基数落在 Entity，**不**拆成 `insert-one` / `insert-many` 两条 IPC：

| 类型                            | 含义                                 |
| ------------------------------- | ------------------------------------ |
| `Read` / `ReadP`                | 查询过滤；`One` \| `Many`            |
| `Write` / `WriteP`              | 创建（无 id；Service 生成 UUID）     |
| `Change` + `Update` / `UpdateP` | 部分更新：`{ key, change }`          |
| `RemoveP`                       | `One(String)` \| `Many(Vec<String>)` |

`WriteP` / `UpdateP` / `ReadP` / `RemoveP` 均为 `#[serde(untagged)]` 的 One/Many。

### Change 可空字段三态

对可清 NULL 的字段使用 `Option<Option<T>>`：

| JSON / Rust            | 含义      |
| ---------------------- | --------- |
| 字段省略 / `None`      | 不修改    |
| `null` / `Some(None)`  | 清成 NULL |
| 有值 / `Some(Some(v))` | 设为 v    |

示例（reminder）：`dueAt`、`fireTime`、`snoozeUntil`、`archivedAt`。

**注意**：前端 TypeScript 里常写成 `dueAt?: number | null`；传给 serde 时「省略」与「显式 null」语义不同——更新时若要清空，需传 `null`；若不想改，不要带该键。

## 审计字段

多数业务表具备：

| 字段         | 含义                                                     |
| ------------ | -------------------------------------------------------- |
| `createdAt`  | 创建时间（ms）                                           |
| `updatedAt`  | 最后更新（ms）                                           |
| `archivedAt` | `NULL` = 活跃；有值 = 终态（完成 / 软删 / 一次性关闭等） |

读接口默认排除已归档（`archived: true` 才包含）。硬删走 `remove`。

## 非标准模块（勿照抄）

| 模块        | 差异                               |
| ----------- | ---------------------------------- |
| `countdown` | `upsert` / 无统一 `*P`；偏单行配置 |
| `asset`     | IPC 可能用 `insert` 而非 `write`   |

新增「列表型业务资源」时，优先对齐 reminder / calendar / mirror / magnetic-tile 的 WriteP 模式。

## Reminder / Calendar 字段速查

完整语义见 [05-reminder-calendar.md](./05-reminder-calendar.md)。Entity 源码：

- [`entity/reminder.rs`](../../../../apps/client/src-tauri/crates/database/src/entity/reminder.rs)
- [`entity/calendar.rs`](../../../../apps/client/src-tauri/crates/database/src/entity/calendar.rs)
