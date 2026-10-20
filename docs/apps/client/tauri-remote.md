# Client 远程 URL 策略

Client **不再**在应用内 Webview 加载第三方网页（已拆除内置浏览 / 子 WebView）。

网址入口一律走 **系统默认浏览器**：

- Overview Command Omnibar（`features/command-bar`）选中 Web / URL → `openUrl`；建议源为 Tauri `search:suggest`（reqwest → Bing AS），不走 daemon `engine.suggestion`
- `navigation` 磁贴 → `openUrl(tile.url)`

权限侧依赖 `opener:allow-open-url` / `opener:allow-default-urls`（见 `capabilities/default.json`），**不再**配置 `remote.urls`。

## 与其他配置的区别

| 配置 | 作用 |
|------|------|
| `opener:allow-open-url` | 可在**外部浏览器**打开的 URL（当前路径） |
| `http:default` | 可通过 HTTP API 请求的 URL（前端 fetch） |
| `remote.urls` | Webview **内**可加载的远程 URL（**已移除**，勿再加回除非恢复内置浏览） |

## 安全建议

1. opener 白名单保持业务必需范围；生产环境避免无边界 `*`。
2. 不要为了「嵌网页」重新引入 `remote.urls` + 子 WebView，除非产品决策明确回退。
