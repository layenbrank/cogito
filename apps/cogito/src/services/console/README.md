# Console 模块（控制台偏好）

平台 ADMIN 的 Backend Console 布局持久化。路由前缀 `/api/v1/console`。

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/preference` | 读取当前管理员偏好；无记录时 `data: null` |
| PUT | `/preference` | upsert 偏好（navOrder / pinnedNav / dashboardWidgets / bookmarks） |

鉴权：`Auth::admin()` + `PlatformScope`。表 `console_preference` 与 `billing_price` 相同：RLS 租户面恒假。
