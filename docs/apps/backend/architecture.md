# Backend Console — 架构

## 边界

```
apps/backend (React SPA)
    │  Bearer JWT + 可选 X-Tenant-ID
    ▼
apps/service /api/v1/*
    │
    ├── 既有 ADMIN 面：users / gateway/* / billing/* / sso/connections / tenants…
    └── 新增：console/preference（控制台布局持久化）
```

- **不做** 第二套业务后端；不写 Node CRUD 服务。  
- **持久化**：业务表仍在 cogito；控制台偏好新增表 `console_preference`。  
- **忽略** `apps/studio`（本次不迁、不依赖）。

## 前端分层（对齐 client，去 Tauri）

```
src/
  apis/          # UPPER_SNAKE，ofetch + HttpEnvelope
  utils/http/    # 浏览器 fetch（无 @tauri-apps/plugin-http）
  utils/auth.ts  # JWT local/sessionStorage；isAdmin()
  stores/        # zustand：session / console-layout
  features/      # 登录、侧栏 DnD、看板小部件
  views/         # 路由页
  components/    # shell、data-table、brand shader
  routers/       # createBrowserRouter + ADMIN loader
```

共享：`@cogito/design`、`@cogito/shared`（RSF 等 ambient）、根依赖 `ofetch` / `zustand` / `lodash-es` / `@dnd-kit/*` / `shaders` / `motion`。

## 偏好表 `console_preference`

| 列 | 类型 | 说明 |
| -- | ---- | ---- |
| id | uuid PK | |
| userID | uuid UNIQUE FK→auth | 一名 ADMIN 一行 |
| navOrder | jsonb | 侧栏模块 id 有序数组 |
| pinnedNav | jsonb | 钉选模块 id |
| dashboardWidgets | jsonb | 概览小部件布局 |
| bookmarks | jsonb | 深链书签 |
| createdAt / updatedAt | timestamptz | |
| creator / updater | uuid | 审计 |

RLS：与 `billing_price` 相同——租户面恒假，读写走 `PlatformScope`（`Auth::admin()` 之后）。服务层按 `actor` 过滤，只读写本人偏好。

## 安全

- 全站业务路由：未登录 → `/signin`；非 ADMIN → 拒绝并提示  
- 密钥字段：仅提交明文一次，UI 只显示 `hasApiKey`  
- 不在前端持久化密码；退出清 token
