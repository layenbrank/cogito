# 前端持久化分层

真源按职责拆开，禁止再引入业务路径 `localStorage` / `sessionStorage`，也不上 Dexie / Stronghold。

## 分层

| 层 | 存什么 | 落点 |
| --- | --- | --- |
| 领域实体 | 看板、磁贴、镜像等业务表 | SQLite（现有 Tauri command / DB） |
| 非密偏好 / 交互态 | 外观、磁贴 chrome、agent 分栏、工程 blob… | Tauri LazyStore JSON（`features/persist`） |
| 密钥 | JWT、provider apiKey | OS Keyring（`keyring` crate + `secret:*` IPC） |

应用内 PIN 的 **hash**（非明文）集中在 `vault.json`；图库等只调 vault API，不各自存一份。

## Store 文件名（单词汇）

| namespace | 文件 | 内容 |
| --- | --- | --- |
| `settings` | `settings.json` | 系统设置（general / capture / shortcuts） |
| `tiles` | `tiles.json` | 磁贴会话 + markdown / code / signboard / bookmark 交互态 |
| `agent` | `agent.json` | 分栏、审批、模型偏好、corex MCP 开关 |
| `window` | `window.json` | 外观、时钟样式、命令栏引擎/最近、tiptap 最近色、记住用户名 |
| `clipchamp` | `clipchamp.json` | 剪辑工程 blob |
| `gallery` | `gallery.json` | 图库域偏好（与 PIN 解耦） |
| `vault` | `vault.json` | 跨域 PIN hash |

## API

- `ensurePersist()` — host / `main` 挂路由前唯一 hydrate 入口
- `findPref(ns)` / `patchPref(ns, patch)` / `replacePref(ns, value)` — 同步读 cache，异步写盘
- `ensureSecrets()` / `findJwtCache()` / `writeJwtSecret()` / `findProviderSecret()` / `writeProviderSecret()`
- 跨窗登录同步：Tauri event `auth:changed`（不再用 `storage` 事件）

## 密钥红线

- JWT：Keyring `service=cogito` / `account=jwt`；未勾选「记住我」只留内存
- goose 侧车：Rust 从 Keyring/会话写入既有 `cogito/jwt` 桥接文件，FE 不直接碰该文件
- provider apiKey：Keyring `account=provider:<id>`；SQLite / goose 配置侧只配合非密元数据
- PIN 明文永不落盘；hash 只在 `vault.json`
