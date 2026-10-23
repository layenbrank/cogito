---
name: service-conventions
description: CoreX Rust HTTP 服务的命名、Schema、CRUD、模块结构、数据库字段、OpenAPI 与模块文档约定。在用户新建/修改 services 模块、schema 结构体、迁移、oas 文档、README、重命名 Request/Response、调整 lib.rs 模块导出、或提到 toRead/toWrite/toUpdate/toRemove、xxxP/xxxR、Swagger/OpenAPI 时务必使用本 skill。
---

# Service Conventions

本 skill 定义 **master** 仓库的编码与文档约定。修改或新增代码前，先对照现有模块（`auth`、`user`、`upload`）保持一致。

## 核心原则

1. **模块命名空间隔离** — 短名可在各模块内复用（如 `auth::schema::Avatar` 与 `user::schema::Avatar`）
2. **简洁优雅** — 去掉冗余前缀/后缀（`Info`、`Api`、`Request`、`Response`）
3. **禁止 `api` 词语** — 结构体、宏、函数名均不出现 `Api`、`api_`（URL 路径 `/api/v1/...` 除外）
4. **lib.rs 统一导出** — 子目录不写 `mod.rs`，在 `src/lib.rs` 内联声明模块树
5. **use 导入顺序** — `std` → 外部依赖（含 `entity` 等 workspace crate）→ 本 crate（`crate::` / `super::` / `self::`），**组间空一行**；组内按路径字母序。可用 `pnpm imports` 批量整理。

---

## Schema 命名

| 角色 | 后缀 | 含义 | 示例 |
|------|------|------|------|
| 请求体 / 查询参数 | `P` | Param | `SigninP`, `WriteP`, `QueryP` |
| 响应 data | `R` | Response | `SigninR`, `UserR`, `ChunkR` |

**迁移对照：**

- `XxxRequest` → `XxxP`（或更短：`ProfileP` 而非 `UpdateProfileP`）
- `XxxResponse` → `XxxR`

**模块内对称命名：**

```rust
// services/auth/schema.rs
pub struct ProfileP { ... }  // PUT body
pub struct ProfileR { ... }  // GET response
pub struct SigninP { ... }
pub struct SigninR { ... }
```

**共享子结构** — 用短名，靠模块区分：

```rust
auth::schema::Avatar
user::schema::Avatar   // 允许同名
```

Schema 文件需：`Serialize`/`Deserialize` + `ToSchema`（OpenAPI 用）。

JSON 字段：`#[serde(rename_all = "camelCase")]`；与 DB 列一致时用 `#[serde(rename = "createdAt")]`。

---

## CRUD 方法命名

Controller / Service / OpenAPI `operation_id` 统一：

| 操作 | 方法名 | HTTP 典型 |
|------|--------|-----------|
| 读 | `toRead` | GET |
| 写（创建） | `toWrite` | POST |
| 改 | `toUpdate` | PUT/PATCH |
| 删 | `toRemove` | DELETE |

```rust
// controller
UserController::toRead / toWrite / toUpdate / toRemove

// service
UserService::toRead(db, id).await

// oas
operation_id = "user.toRead"
pub fn toRead_doc() {}
```

非 CRUD 动作可用语义化名（如 `signin`、`signup`、`prepare`），但同一模块内保持风格一致。

---

## 响应封装（禁止 Api 前缀）

| 类型/宏 | 用途 |
|---------|------|
| `Envelope<T>` | 成功响应信封 |
| `Exception` | 异常响应 |
| `ok!` / `created!` / `no_content!` / `fail!` / `paginated!` | Controller 快捷宏 |
| `envelope!`（`oas/common.rs`） | 生成具象 OpenAPI Envelope（如 `SigninEnvelope`） |

业务成功码：`200000`（`utils::code::SUCCESS`）。HTTP 状态码对外恒为 200，结果看 `body.code`。

---

## 模块结构

### lib.rs 导出（不要 mod.rs）

```rust
pub mod services {
    pub mod auth {
        pub mod controller;
        pub mod module;
        pub mod schema;
        pub mod service;
    }
    // ...
}

pub mod bootstrap {
    pub mod module;
    pub mod static_assets;
    // pub use 重导出
}
```

`bootstrap`、`services` 等同理：**子模块文件直接声明，聚合逻辑放 lib.rs**。

### 每个 service 模块

```
src/services/{name}/
├── controller.rs   # HTTP 处理器，调用 service
├── module.rs       # 路由注册
├── schema.rs       # P/R 结构体
├── service.rs      # 业务逻辑
└── README.md       # 模块文档（必须）
```

可选：`http/*.http` REST Client 用例。

### 复杂度例外（额外文件）

默认只允许上述四文件 + README。体量大的模块可拆分，但须在 README 写明职责，并登记到 `scripts/arch.ts`：

| 模块 | 额外文件 | 原因 |
|------|----------|------|
| `upload` | `validation` / `storage` / `repository` / `error` / `multipart` | 分片上传 + 归属校验，单文件过重 |

禁止新建 `services/shared`；跨模块复用优先放在**拥有该领域**的模块（如 profile 辅助在 `auth::service`），或 `utils/` / `guards/` 等横切层。

架构卫生：`pnpm arch`（CI 会跑）。

---

## 数据库字段

### 命名

- **DB 列名**：单个词语、**camelCase**（`createdAt`、`archivedAt`）
- **Rust entity 字段**：snake_case + `#[sea_orm(column_name = "createdAt")]`
- **标识 / 外键后缀**：用 **`xxxID`**，禁止 **`xxxId`**
  - 正确：`tenantID`、`assetID`、`deviceID`
  - 错误：`assetId`、`uploaderId`
  - Rust：`tenant_id` / `asset_id` + `column_name = "tenantID"` / `"assetID"`
  - 例外：主键列名仍为单词 **`id`**（全小写）
  - JSON 与 DB 列一致时同样用 `xxxID`（如 `#[serde(rename = "tenantID")]`）

### 通用审计字段（大部分表必备）

| 列 (DB) | 类型 | 说明 |
|---------|------|------|
| `createdAt` | timestamptz | 创建时间 |
| `creator` | uuid FK → auth.id | 创建人 |
| `updatedAt` | timestamptz | 更新时间 |
| `updater` | uuid FK → auth.id | 更新人 |
| `archivedAt` | timestamptz NULL | 软删/归档 |
| `expiresAt` | timestamptz NULL | 过期时间 |

新建表时默认包含以上字段（除非有明确理由省略）。详见 [`guide/database.md`](guide/database.md)。

---

## OpenAPI / Swagger

目录：`src/oas/`（不是 openapi）

| 文件 | 职责 |
|------|------|
| `mod.rs` | `OpenDoc` derive、schema 注册、`ALL_ROUTES` |
| `{module}.rs` | `#[utoipa::path]` 文档函数（`signin_doc`、`toRead_doc`） |
| `common.rs` | `envelope!` 宏、`Exception`、示例 |
| `paths.rs` | 路由清单 |

**workflow — 新增接口：**

1. 在 `services/{m}/schema.rs` 定义 `P`/`R` + `ToSchema`
2. 在 `services/{m}/controller.rs` 实现 handler
3. 在 `oas/{m}.rs` 添加 `#[utoipa::path]`（含 `summary`、`description`、成功/失败 `body`）
4. 在 `oas/mod.rs` 的 `paths(...)` 与 `components/schemas(...)` 注册
5. 运行 `cargo run --bin docs` → `spec/openapi.json`
6. 运行 `cargo test --test oas_consistency`

**文档要求：**

- 每个 operation 有中文 `summary` + 详细 `description`
- 注明是否 JWT、`body.code` 语义
- `operation_id` 格式：`{module}.{action}`（如 `auth.toRead`）
- 成功/典型错误均声明 `body = XxxEnvelope` 或 `Exception`

详细模式见 [references/oas.md](references/oas.md)。

---

## 模块 README

每个 `src/services/{name}/` **必须**有 `README.md`，风格对齐 [`src/services/auth/README.md`](src/services/auth/README.md)。

**必含章节：**

1. 标题 + 路由前缀
2. 概述（能力表）
3. 与同域其他模块的区别（如 auth vs user）
4. 路由一览（方法、路径、鉴权、说明）
5. 鉴权说明
6. 数据表（读写哪些列）
7. 表协作 / ER（若有关联）
8. 实现架构（调用链树状图）
9. 接口详情（请求/响应示例、错误码）

模板见 [references/module-readme.md](references/module-readme.md)。

新增模块后，在根 [`README.md`](README.md) 的「模块文档」表格追加链接。

---

## 检查清单

新建或审查模块时：

- [ ] 请求/响应命名为 `P` / `R`，无 `Request`/`Response`/`Api` 前缀
- [ ] CRUD 使用 `toRead` / `toWrite` / `toUpdate` / `toRemove`
- [ ] 模块在 `lib.rs` 声明，无 `mod.rs`
- [ ] 迁移含通用审计字段，列名 camelCase
- [ ] `oas/` 文档 + `oas_consistency` 测试通过
- [ ] `services/{name}/README.md` 已写并链到根 README
- [ ] `#![allow(non_snake_case)]` 已在 lib.rs（允许 `toRead` 等 camelCase）
- [ ] `pnpm arch` 通过（复杂度例外已登记）

---

## 参考

- [模块 README 模板](references/module-readme.md)
- [OpenAPI 模式](references/oas.md)
- [数据库通用字段](references/database-fields.md)
