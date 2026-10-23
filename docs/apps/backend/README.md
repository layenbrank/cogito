# Backend Console（`apps/backend`）

平台运维控制台：**纯 Web**（React 19 + TypeScript + Vite），架构对齐 `apps/client` 的前端层，**不含 Tauri**。业务真相与鉴权一律走 `apps/service`（`Auth::admin()`）。

| 文档 | 说明 |
| ---- | ---- |
| [product-design.md](./product-design.md) | 产品定位、IA、模块、体验原则 |
| [architecture.md](./architecture.md) | 前端分层、与 cogito 的边界、持久化 |
| [development.md](./development.md) | 本地开发与环境变量 |

产品名对内：**Backend Console**；包名：`@cogito/backend`；默认端口 **8300**。
