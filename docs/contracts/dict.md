# 状态字典契约

产品状态字典采用**全局 value 编号空间 + type 认领 + 租户覆盖**。

## 边界

### 纳入

- Client 本地 11 个 `typeCode`（见 `dict.yaml`）
- Service 桥接台账：`rag_index_task.status`、`agent_task.status`、`scheduled_job.lastStatus`

### 排除（保持英文枚举 / 原类型）

- `auth` / `tenant` / `tenant_member` 的 `ACTIVE`/`DISABLED`
- `subscription` / `payment_order`
- 服务端 `asset.status`（UploadStatus；≠ client `asset_status`）
- `gateway_provider` / `sso_connection`
- `exception.status`（HTTP 整数）、health、agent approval

## 规则

- `value`：平台唯一三位码，只增不改号
- `key`：稳定语义标识（业务分支认 key）；池内唯一
- `label`：可远程改；合并顺序 `tenant ?? type_item ?? item`
- **同一语义 + 同一默认文案 → 只占一号，多个 type 分别认领**（如 `ACTIVE`/`ARCHIVED`）
- 仅当默认文案或语义不同时才新开号（如「索引中」≠「执行中」）
- `dict_type_item` 主键是 `(typeCode, value)`：**允许多 type 认领同一 value**，不是独占

跨 type 共享示例：`ACTIVE`(029)、`ARCHIVED`(030) 被 `asset_status` / `album_status` 共用；文档状态也可认领 `ARCHIVED`。

机器可读定义见同目录 [`dict.yaml`](./dict.yaml)；TS 导出见 `@cogito/dict`。
