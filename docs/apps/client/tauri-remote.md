# Client 远程 URL 策略

Client **有**内置浏览器：`src-tauri/src/browser/` 用 child webview（`WebviewBuilder::new(label, WebviewUrl::External(url))` + `window.add_child`）承载第三方网页，
标签页面板、`app_browser_*` 工具、CDP 注入都挂在这套 child webview 上。

主 webview（`main` 窗口）**不**加载任何第三方网页 —— 这才是不配 `remote.urls` 的真实原因：

- 早期文档写的「已拆除内置浏览 / 子 WebView」是**错的**（本次校正）：拆掉的是「主 webview 加载远程 URL」，
  不是「应用内没有浏览器」。
- 主 webview 的 CSP（`tauri.conf.json` 的 `app.security.csp`）因此不需要放开 `frame-src` / `https://*`：
  第三方页面在 child webview 里，CSP 不继承。

## 两个入口

1. **系统默认浏览器**：Overview Command Omnibar（`features/command-bar`）选中 Web / URL → `openUrl`；
   建议源为 Tauri `search:suggest`（reqwest → Bing AS），不走 daemon `engine.suggestion`。
2. **应用内浏览器面板**：`app_browser_open`（Agent 工具）与浏览器面板 UI → `browser::lifecycle` 建 child webview。

## 与其他配置的区别

| 配置 | 作用 |
|------|------|
| `opener:allow-open-url` | 可在**外部浏览器**打开的 URL（当前路径） |
| `http:allow-fetch*` | 前端 `tauriFetch` 可请求的 URL（已收到 loopback + https，明文 http 通配已删） |
| `app.security.csp` | **主 webview** 的内容安全策略（2026-11 起不再是通配） |
| `remote.urls` | Webview **内**可加载的远程 URL（未配置，也**不要**加） |

## 安全建议

1. opener 白名单保持业务必需范围；生产环境避免无边界 `*`（本轮尚未收，见 S1/1B）。
2. 需要看网页就走 child webview 或系统浏览器，**不要**通过 `remote.urls` 让主 webview 加载远程内容 ——
   那会把主 webview 的全部 IPC 能力暴露给第三方页面。
3. 主 webview 的 CSP 改动后要回归：截图/贴图/图库（`asset:`）、剪辑帧与波形、Monaco worker（`worker-src blob:`）、
   ffmpeg wasm（`wasm-unsafe-eval`）、pdfium。
