# Dict 模块（产品状态字典）

全局池 + 类型认领 + 租户覆盖。路由前缀 `/api/v1/dict`。

同一池 `value` **可被多个 type 认领**（主键 `(typeCode, value)`）；同语义同默认文案应共用一号（如 `ACTIVE`/`ARCHIVED`），仅文案或语义不同时新开号。

路由注册用逐条 `web::resource`（勿再并列两个 `scope("/dict")`，否则已登录会 404）。

## 成员（JWT + `X-Tenant-ID`）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/v1/dict` | 当前租户合并目录（仅已认领且 enabled 的项）+ `revision` |

## 平台 ADMIN（`PlatformScope`）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/v1/dict/types` | 类型列表（含认领条目，合并 label） |
| POST | `/api/v1/dict/types` | 新建类型 |
| PUT | `/api/v1/dict/types/{code}` | 更新名称 / 描述 |
| GET | `/api/v1/dict/items` | 全局池 |
| POST | `/api/v1/dict/items/allocate` | 分配下一 value（三位递增） |
| PUT | `/api/v1/dict/items/{value}` | 更新 label / sort / enabled / meta（revision+1） |
| POST | `/api/v1/dict/types/{code}/claims` | 批量认领 |
| DELETE | `/api/v1/dict/types/{code}/claims/{value}` | 取消认领 |
| PUT | `/api/v1/dict/tenants/{tenantId}/items` | 租户覆盖 upsert |
| GET | `/api/v1/dict/tenants/{tenantId}` | 租户合并视图 |

合并规则：`label = tenant ?? type_item ?? item`；`enabled = tenant.enabled ?? item.enabled`。

契约种子见 `docs/contracts/dict.yaml`；迁移 `up` 写入初始池 / 类型 / 认领。
