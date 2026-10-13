# Migrations

SeaORM 官方迁移 crate。记账表为 `migration`（覆盖默认的 `seaql_migrations`）。

## CLI

```bash
cargo install sea-orm-cli@^2.0
```

`.env` 已移除。**本 crate 的 bin**（`cargo run -p migration -- …`）经 `configures` 读 YAML 的 `database.url` 并注入 `DATABASE_URL`；但 **官方 `sea-orm-cli` 只认 `DATABASE_URL` 环境变量或 `-u`**，直接用 CLI 时要先导：

```powershell
# PowerShell：密码与 apps/cogito/.env 的 POSTGRES_PASSWORD 一致（本机连 Docker 的 cogito-postgres）
$env:DATABASE_URL='postgres://machenike:<POSTGRES_PASSWORD>@127.0.0.1:5432/i-thinking'
sea-orm-cli migrate fresh
```

```bash
# 在仓库根目录
sea-orm-cli migrate status
sea-orm-cli migrate up
sea-orm-cli migrate down
sea-orm-cli migrate fresh

# 或直接跑本 crate
cargo run -p migration -- up
cargo run -p migration -- status
```

生成新迁移：

```bash
sea-orm-cli migrate generate NAME_OF_MIGRATION
```

应用启动时会调用 `Migrator::up`，一般不必单独跑 CLI。

## 单世代策略

迁移**只保留一代**：`000001_20260819` 一次性建出全部业务表（auth / asset / chunk / tenant / tenant_member / subscription / payment_order / gateway_* / sso_connection / outbox / consumed_event），并建出 RLS 判定函数 `app_current_tenant_id()` 与各表策略。其 `up` 会先按依赖倒序 **DROP** 全部业务表（`cascade`）再重建，因此改 schema 时**直接改这个文件**，不要再追加新版本。

新增表时必须同时改三处：`up` 的建表列表、`up` 里最后用于重建的 DROP 列表、`down` 的 drop 列表——漏掉就会在重建后残留旧结构。

代价是：该迁移面向**全新空库**或**可重建的开发库**。已经跑过它的库，因为记账表 `migration` 里同名记录仍在，`up` 会被跳过——需要重建时执行：

```bash
cargo run -p migration -- fresh     # 或 sea-orm-cli migrate fresh
```

记账表 `migration` 由 Migrator 维护，不要在业务迁移里 DROP。

## 列名约定

- **DB 列名一律 camelCase，禁止 snake_case**（`createdAt`、`tenantID`、`baseURL`、`apiKeyEnc`、`promptTokens`…）；主键列名仍为单词 `id`。
- Rust entity 字段仍用 snake_case，靠 `#[sea_orm(column_name = "createdAt")]` 映射。
- 标识 / 外键统一 `xxxID` 后缀（`tenantID`、`providerID`、`assetID`），**不是** `tenantId`。
- ⚠️ **`DeriveIden` 会把多词字段名自动转成 snake_case**（`ProviderId` → `provider_id`、`BaseUrl` → `base_url`），所以枚举里必须显式写 `iden`，光靠字段名不生效：

```rust
#[derive(DeriveIden)]
enum GatewayModel {
    Table,
    #[sea_orm(iden = "providerID")]   // 漏了这句就会建出 provider_id
    ProviderId,
    #[sea_orm(iden = "allowRoles")]
    AllowRoles,
}
```

- 记账表 `migration` 自身例外：它的列是框架定的 `version` / `applied_at`。
