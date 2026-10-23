# Upload 模块

大文件分片上传与下载。路由前缀 `/api/v1/upload`。

## 概述

企业级三层模型：

| 层 | 含义 | 本仓库对应 |
|----|------|------------|
| 物理 CAS | 按内容 hash 全局单副本，跨用户复用字节 | `cas/{sha256}` |
| 上传会话 | 短暂任务；`cancel` 才硬删。秒传标 **SUPERSEDED**，会话 id 仍可调用 | `asset` 行 PENDING/UPLOADING/SUPERSEDED |
| 逻辑文件 | 按用户隔离的成片元数据 | `asset` COMPLETED + 本人 `chunk` 元数据行 |

流程：**prepare →（分片上传 ∥ 算 hash，算完即 PATCH）→ finalize → 流式下载**。

| 能力 | 说明 |
|------|------|
| 异步 hash | `prepare` 可不传整文件 hash；**与分片并行计算**，算完立刻 `PATCH /hash`（勿等全部分片传完，也不必等 hash 才开传） |
| 文件秒传 | 同 hash 且 size/chunk 一致：本人返回已有 COMPLETED；跨用户 **克隆**逻辑行（`name` 用当前请求）；当前会话标 **SUPERSEDED**（不 DELETE） |
| 分片秒传 | 分片写入全局 `cas/{sha256}`；任意用户 hash 命中即可 `reused`（零拷贝） |
| 断点续传 | 按**本会话**返回 `uploaded[{index,hash}]`；同 hash+用户可恢复 PENDING/UPLOADING |
| 废弃会话 | `cancel` → `discard_session`（删 asset，CASCADE chunk 元数据，CAS 保留）。秒传**不**硬删；在途 chunk 对 SUPERSEDED/COMPLETED 幂等 200 |
| FAILED | 仅真实失败（校验等）；**不是**秒传或取消 |
| SESSION_GONE | `500207`：会话 id 无效或已被 cancel/GC。秒传路径不用此码，也不再用 `200003` |
| 不合并落盘 | finalize 只校验；下载时按 `chunk` 表顺序流式输出 |
| 可见性 | `PRIVATE`（默认）/ `PUBLIC`（可匿名下载）/ `RESTRICTED`+`viewers`；仅影响按 id 下载。写入口只有创建者自己的路径（`prepare` 时设定、绑定头像时提升为 `PUBLIC`）与本节的服务令牌通道 |
| 下载隔离 | 按可见性 ACL，且**行级策略**二次兜底：看不见的行直接按「不存在」处理（404，不泄露存在性） |
| 行级策略 | `asset` 的可见性判定写在数据库策略里（五个分支，见下文「行级策略」）；service 只开作用域，不手写 `WHERE` |
| 本人列表 | `GET /files` 分页列出当前用户资产（默认 COMPLETED） |

## 路由一览

| 方法   | 路径                           | 鉴权   | 说明                          |
| ------ | ------------------------------ | ------ | ----------------------------- |
| POST   | `/api/v1/upload/prepare`       | JWT    | 初始化（hash 可选）           |
| PATCH  | `/api/v1/upload/hash`          | JWT    | 绑定整文件 SHA-256（宜尽早）  |
| POST   | `/api/v1/upload/chunk`         | JWT    | 上传/秒传分片（multipart）    |
| POST   | `/api/v1/upload/finalize`      | JWT    | 校验完成（不合并）            |
| GET    | `/api/v1/upload/progress/{id}` | JWT    | 查询进度                      |
| DELETE | `/api/v1/upload/cancel/{id}`   | JWT    | Abort：硬删未完成会话         |
| GET    | `/api/v1/upload/files`         | JWT    | 本人资产列表（分页）          |
| GET    | `/api/v1/upload/files/{hash}`  | JWT    | 按 hash 流式下载（仅本人）    |
| GET    | `/api/v1/upload/asset/{id}`    | 可选 JWT | 按资产 id 流式下载（PUBLIC 可匿名） |
| GET    | `/api/v1/service/assets/{id}/content` | 服务令牌 | 服务身份读原始字节（叶子服务用，见下） |
| PUT    | `/api/v1/service/assets/{id}/visibility` | 服务令牌 | 服务身份改可见性（无请求体，见下） |

> 最后两条**不在** `/upload` 前缀下，也不在本模块注册路由：它们是服务身份面的写读端点，挂在本模块
> 公开的 handler 上，路由由 [`gateway/module.rs`](../gateway/module.rs) 的 `/service` scope 注册
> （否则「能不能读 / 能不能写」会有两处判定）。语义见
> [`gateway/README.md`](../gateway/README.md#服务身份apiv1service)。

## 鉴权说明

`/upload` 前缀下全路由挂载 [`Auth::isRequired()`](../../guards/auth.rs)；其中 `GET /asset/{id}` 由 [`guards::public`](../../guards/public.rs) 放行匿名（可选 JWT）。

`prepare` 从请求身份上下文 `Session` 的 `user_id()` 写入 `asset.creator`；`visibility` 默认 `PRIVATE`。  
`chunk` / `hash` / `finalize` / `progress` / `cancel` 校验归属（仅创建者）。  
`GET /files` 与按 hash 下载仍仅本人；`GET /asset/{id}`：`PUBLIC` 可匿名，其余按 ACL。  
跨用户文件秒传会为命中用户克隆逻辑行（克隆默认 `PRIVATE`）。分片 CAS **全局**共享。

## 行级策略（RLS）

`asset` 不做「service 里手写 `WHERE`」，可见性由数据库行级策略兜底；service 只负责**开作用域**，
作用域句柄都在 [`src/guards/asset.rs`](../../guards/asset.rs)：

| 通道 | 句柄 | 作用域 | 判定依据 |
| ---- | ---- | ------ | -------- |
| 本人写路径 | `AccountScope` | `app.user_id` | 创建者分支（写入时 `WITH CHECK` 只认 `creator = 当前用户`） |
| 单条读 / 裸读 | `AssetReader::enter(db, user_id)` | `app.user_id`，或匿名（`app.user_id` 缺省） | 创建者分支 / 公开分支 / `viewers` 分支 |
| 内容寻址（秒传） | `AssetContentScope::open(db, hash)` | `app.asset_hash` | `hash` + `status = COMPLETED` 的能力键 |

读策略 `USING` 的五个分支（任一成立即可见）：

```
"creator" = app_current_user_id()                      -- 自己建的
OR "tenantID" = app_current_tenant_id()::text           -- 租户内（仅租户作用域成立）
OR "visibility" = 'PUBLIC'                              -- 公开：全局成立，匿名也看得见
OR "viewers" ? app_current_user_id()::text              -- RESTRICTED 白名单点到自己
OR ("hash" = app_current_asset_hash() AND "status" = 'COMPLETED')  -- 秒传借用他人已完成内容
```

- `PUBLIC` 是**全局分支**：它在**任何**作用域里都成立，包括只带 hash 的能力键作用域。
  因此按 hash 读到的集合是「命中 hash 的已完成行 ∪ 公开行」——后者本就可匿名读，不构成泄露。
- `AssetContentScope` 只借**内容**不借所有权：命中的是别人的行，也读得到（跨账号秒传的前提）；
  但要求 `status = COMPLETED`，避免猜到 hash 的人续传别人的上传会话。
- 账号作用域下没有租户，`tenantID` 分支恒不成立；跨账号秒传必须走 `AssetContentScope`。
- 头像属于档案数据、按下 id 直接渲染，因此绑定头像时会把 `visibility` 提为 `PUBLIC`（见 [auth README](../auth/README.md)）。
- `chunk` 表**暂时没有** RLS：隔离经 `asset` 传递（先有可见的 asset 才谈得上它的分片）。

**403 → 404**：`GET /asset/{id}` 与按 hash 下载先取行、再判权限。策略看不见的行等同于不存在，
返回 `500204`（FILE_NOT_FOUND，HTTP 404）；只有**看得见但没权限**（如 `RESTRICTED` 而不在白名单）才返回
`400004`（ACCESS_RESTRICTED，HTTP 403）。旧实现先判 ACL 再读行，任何行都能被探测出「存在」，已修正。

## 数据表 — asset

| 列                          | 用途                                                    |
| --------------------------- | ------------------------------------------------------- |
| id                          | 上传任务 / 资产 ID（UUID）                              |
| tenantID                    | 租户 ID（可空；租户模型未接线前可不传）                 |
| kind                        | `upload`                                                |
| hash                        | 整文件 SHA256；可先空，hash 就绪后立即 PATCH 绑定       |
| sha                         | finalize 校验后的整文件 SHA                             |
| superseded                   | 秒传后指向目标 COMPLETED；本行 status=SUPERSEDED        |
| size, mime, name, extension | 文件元信息                                              |
| index                       | **资产列表排序**（用户可自定义，默认 0）；≠ chunk.index |
| status                      | PENDING → UPLOADING → COMPLETED / SUPERSEDED / FAILED / EXPIRED |
| visibility                  | PRIVATE（默认）/ PUBLIC / RESTRICTED                    |
| viewers                     | jsonb：RESTRICTED 时的可下载用户 UUID 列表              |
| chunk, total                | 分片大小与分片总数                                      |
| creator, updater, expiresAt | 归属与 24h 过期（完成后 clears expiresAt）              |

## 数据表 — chunk

| 列                          | 用途                                                    |
| --------------------------- | ------------------------------------------------------- |
| id                          | 分片记录 UUID                                           |
| assetID                     | → asset.id（CASCADE）                                   |
| index                       | **分片序号**（从 0 起）；与 assetID 唯一                |
| hash                        | 分片内容 SHA-256（CAS key）                             |
| size                        | 分片字节数                                              |
| createdAt, creator          | 审计                                                    |

> **注意**：`asset.index` 是租户内文件排序；`chunk.index` 是分片下标。二者无关。

## 磁盘协作

| 路径 | 用途 |
|------|------|
| `cas/{sha256}` | **唯一**分片物理副本；跨会话/跨用户复用，不拷贝 |

finalize **不会**生成整文件；下载时服务端按 `chunk` 表 `index` 顺序读 CAS 写入同一 HTTP 响应（`Content-Length` = `size`）。

**CAS 回收**：本阶段不做自动 GC。后续可按 `chunk.hash` 引用计数或孤儿扫描清理。

**并发写分片**：`upsert_chunk` 用 `INSERT … ON CONFLICT DO NOTHING` + 再读校验，避免并行同 index 冲突。

## 推荐前端交互

服务端**不按文件大小分流**。同时支持 `prepare` 带 hash（入口秒传）与不带 hash（分片 ∥ 算 hash，算完 `PATCH /hash`）。何时先算、何时先传由客户端决定：

- **小文件**：先算完整 hash 再 prepare（命中则 0 分片）
- **大文件**：先 prepare 并上传，hash 并行，算完即绑

1. 选文件后**立刻** `prepare`（可不带 hash），同时开始算整文件 hash **并并行上传分片**。
2. 整文件 hash **一算完**就 `PATCH /hash`（不必等分片传完）：若 `exists` → 停止分片队列。临时会话变为 **SUPERSEDED**（id 仍有效）；在途 `chunk` / `progress` / `finalize` 幂等成功，`superseded` 指向已完成资产。
3. 未秒传：继续缺片；CAS 可命中时可不带字节。
4. 续传以服务端 `progress` / `uploaded[{index,hash}]` 为准（本会话）。
5. `finalize` 后用 `/api/v1/upload/asset/{id}` 下载；或 `GET /files` 取 url。秒传后也可用原会话 id 下载（服务端跟随 `superseded`）。
6. 小文件仍可先算 hash 再 prepare，以在 prepare 阶段命中文件秒传。

并发建议 3–4。**不要**等全部分片传完再 PATCH hash；也**不必**等 hash 算完才开始传分片。

`500207`（SESSION_GONE）仅表示 id 无效或已 cancel；**不要**把它和「CAS 中不存在」或秒传混为一谈。秒传时 chunk 返回 `200000` + `reused`。

### 与常见对象存储的差异（企业级对齐）

| 点 | OSS / S3 Multipart 等 | 本服务 |
|----|----------------------|--------|
| 上传会话 id | Complete 前稳定，不中途换成另一个 UploadId | 秒传将当前会话标 SUPERSEDED，**id 仍可调用**；返回的 `exists.id` 是 COMPLETED 资产 |
| 整对象校验 | 多在 Complete 时核对 | 允许提前 bind hash；未完成前会话 id 不变 |
| 客户端停传 | 仅在服务端明确「已完成/秒传」时 Abort | 仅 `exists: true` 时 abort；在途请求应对 SUPERSEDED 视为成功 |

## 实现架构

```
UploadController::prepare
  └── UploadService::prepare
        └── validate / find_completed(+layout) / clone_completed_for(name) / insert

UploadController::bind_hash
  └── UploadService::bind_hash
        └── COMPLETED 布局一致 → 文件秒传：当前会话 SUPERSEDED + superseded，不 DELETE
        └── 另有同 hash 的 PENDING → discard *旧* 会话，保留当前正在传的会话并 bind
        └── 否则 bind asset.hash，继续分片（靠 CAS 复用）

UploadController::chunk
  └── UploadService::chunk
        └── SUPERSEDED / COMPLETED → 幂等 200 reused（不写 chunk 行）
        └── CAS 命中 → 仅 INSERT chunk 行（零拷贝）
        └── 未命中 → 写入 cas/{hash} + INSERT chunk

UploadController::finalize
  └── UploadService::finalize
        └── 按 chunk 表顺序流式校验整文件 hash
        └── mark_completed（保留 CAS）

UploadController::cancel
  └── discard_session（硬删未完成会话）

UploadController::toRead_files
  └── 本人资产分页列表

UploadController::serve_asset / serve_file
  └── 按序 stream_cas_chunks → 单一响应体

UploadController::service_content（路由挂在 gateway 的 /service scope）
  └── UploadService::service_asset_content → service_asset_parts（与签发令牌同一段判定）
```

常量（[`validation.rs`](validation.rs)）：最大 10GB、分片 10MB~100MB、过期 24h。

---

## 接口详情

### POST /api/v1/upload/prepare

```json
{
  "name": "sample.pdf",
  "size": 1048576,
  "hash": "可选，64位sha256",
  "mime": "application/pdf",
  "chunk": 1048576
}
```

**成功 data**

```json
{
  "id": "upload-uuid",
  "exists": false,
  "chunks": [0, 1],
  "uploaded": [{ "index": 0, "hash": "..." }],
  "url": "/api/v1/upload/chunk"
}
```

### PATCH /api/v1/upload/hash

```json
{ "id": "upload-uuid", "hash": "64位sha256" }
```

返回 `exists` / `uploaded`（同 prepare 语义）。秒传时 `id` 为已完成资产；原会话变为 SUPERSEDED。

### POST /api/v1/upload/chunk

multipart 字段：`id`、`index`、`hash`、`chunk`（CAS 已存在时可省略）。

**成功 data**：`{ "success": true, "index": 0, "reused": true, "message": "..." }`

### POST /api/v1/upload/finalize

须已绑定 hash 且 `chunk` 表分片齐全。校验通过后 `status=COMPLETED`，**不写合并文件**。  
返回 `url`：`/api/v1/upload/asset/{id}`。

### GET /api/v1/upload/files

Query：`page`（默认 1）、`size`（默认 20，最大 100）、`status`（默认 `COMPLETED`）。

**成功 data**：分页 `items[]`（`AssetR`：id / tenantID / name / size / mime / hash / index / status / visibility / viewers / createdAt / url）。

### GET /api/v1/upload/files/{hash}

流式拼接分片；仅本人 COMPLETED 同 hash 资产。

### GET /api/v1/upload/asset/{id}

按资产 id 流式下载。判定顺序是**先可见、再判权**：

| 情况 | 结果 |
| ---- | ---- |
| `PUBLIC` | 匿名即可下载 |
| `PRIVATE` 且本人是创建者 | 可下载 |
| `RESTRICTED` 且本人在 `viewers` | 可下载 |
| 行级策略看不见（他人 `PRIVATE`、不在白名单、账号作用域下带 `tenantID` 的行…） | `500204` 文件不存在（HTTP 404），不暴露存在性 |
| 看得见但无下载权限 | `400004` 资源访问被限制（HTTP 403） |
| 尚未 `COMPLETED` | `200003` 请求参数值无效：`文件尚未完成上传` |
| 秒传后的老会话 id | 跟随 `superseded` 指向的目标，再按上表判定 |

### GET /api/v1/service/assets/{id}/content

服务身份读原始字节，给叶子服务（compute）用。与 `GET /upload/asset/{id}` 的差别是**授权来源**：

|  | `/upload/asset/{id}` | `/service/assets/{id}/content` |
| ---- | ---- | ---- |
| 身份 | 用户 JWT（可匿名，靠 `PUBLIC`） | `X-Service-Token`（`scope=asset-read`，见 [`gateway/README.md`](../gateway/README.md#服务身份apiv1service)） |
| 授权依据 | 行可见性 + ACL（`visibility` / `viewers` / 创建者） | 令牌作用域里的单个 `assetID`；**路径参数只用于比对**，不一致 `400004`（403） |
| 响应 | 同上下载 | 原始字节流，**不计量、不记账** |

可见性口径与上表共用同一段判定（`service_asset_parts`），只是放行条件换成「令牌里就是这个资产」；
所以「别的租户的行 → 404、未完成 → 400」完全一致。

### PUT /api/v1/service/assets/{id}/visibility

服务身份改可见性，给「AI 提议、人批准」的场景用。**没有请求体**——要写的参数在换令牌时就已经定稿了：

| | |
| ---- | ---- |
| 身份 | `X-Service-Token`（`scope=asset-write`，见 [`gateway/README.md`](../gateway/README.md#服务身份apiv1service)） |
| 参数来源 | 令牌载荷里的 `visibility` / `viewers`（签发时从 `agent_approval` 台账的审批原文解析而来） |
| 落地身份 | 审批里的**批准人**（必须等于资产创建者，否则签不出令牌）——写的是**该用户的**作用域 |
| 成功响应 | 裸 `AssetR`（与下载同族，便于调用方直接回显新状态） |
| 幂等 | 是：同一枚令牌重放结果相同（`visibility` / `viewers` 是绝对赋值，不是增量） |

要表达的口径：

- **`id` 与令牌里的 `assetID` 必须一致**，不一致 `400004`（HTTP 403）；不存在 / 看不见的行 `500204`（HTTP 404）——
  与读内容完全同款，不给探测留缝。
- **审批凭据不合规一律 `500509`（HTTP 403）**：审批不是「已批准」、批的不是这个资产、批准人不是创建者、
  审批原文里的可见性不是三个字面量之一、名单里有非用户 id、非 `RESTRICTED` 却带了名单……
  全都归到同一个码，具体原因只进日志。
- **`PRIVATE` / `PUBLIC` 会清空名单**：`update_visibility` 只在 `RESTRICTED` 下写入 `viewers`，
  其余情况一律置 `null`，避免「改回私有却留着半张白名单」这种沉默的权限残留。
- 写入**不计量、不记账**：它不是算力消耗，改的是一行元数据。

## 手工测试

- [`scripts/upload.ts`](../../../scripts/upload.ts) — prepare → chunk → bind hash → finalize → 列表 / asset 下载
- [`http/upload.http`](http/upload.http)
- [`http/03-upload.http`](../../../http/03-upload.http)
