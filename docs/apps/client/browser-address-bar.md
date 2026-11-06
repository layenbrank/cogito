# 右栏浏览器：地址栏语义（「改地址不加载」的正解）

> 结论先行：地址栏回车必须**显式处理**，导航必须**离开主线程**，同地址回车必须**变成刷新**。
> 这三条缺任意一条，用户看到的就是「改了地址毫无反应，只能新开标签页」。

## 1. 现场证据

日志 `%LOCALAPPDATA%\com.cogito.client\logs\cogito.log` 里，`browser: 导航 …` 只有两种来源：

| 来源 | 日志形状 | 结果 |
| --- | --- | --- |
| agent 工具面（`app_browser_open` 复用） | `请求打开 … force_new=false` → `复用同 host tab` → `导航` | ✅ 页面真的换了 |
| 地址栏回车（`browser_navigate`） | 只有一行 `导航 …`（可能连续三四次同一地址） | ❌ 页面不动 |

两者最终都跑同一个 `lifecycle::navigate`，唯一的差别是**调用线程**：`browser_open` 是
`async + spawn_blocking`，`browser_navigate` 是同步命令（在主 webview 的 IPC 回调里执行）。
同步命令里 `Webview::navigate` 会走 `send_user_message` 的主线程内联分支，等于在 WebView2
自己的回调栈上再调它的导航 API —— 返回 `Ok`、页面不动、也没有 `failed to navigate` 日志。
同一个坑在这个仓库里已经踩过一次（见 `browser_open` 的注释），当时是 `add_child` 自锁。

另外两个前端问题让现象更糟：

- 回车完全依赖 `<form>` 的隐式提交（`base-ui` 的 `Button` 会把 `type` 强制成 `button`），
  隐式提交在 WebView2 里并不保证发生；
- `submitAddress` 取 `omniboxRows[omniboxIndex]`（默认首条 = 建议行），回车会被「首条建议」劫持。

## 2. VS Code 的标准做法（`browserView/electron-browser/widgets/browserUrlBarWidget.ts`）

VS Code 的浏览器是「编辑器 + contribution」，地址栏是独立 widget，**不是表单**：

- **Enter 显式处理**：`keydown` 里 `KeyCode.Enter` → `preventDefault()` → `_navigateText(value)` →
  `_suppressBlurRevert = true`（提交后的那次 blur 不许把输入回落掉）；
- **Escape**：`_renderUrl()` 回落到 canonical URL，并把焦点交还页面；
- **blur**：只有「文本 ≠ canonical URL 且没有打开的 picker」才回落；
- **canonical URL 来自模型**（`host.input?.url`），即 webview 的真实地址；导航在飞时用
  `previewUrl()` 乐观显示，但用户正在编辑时不覆盖；
- **提交内容就是用户输入**，只有**显式点选**建议才用建议项（`getPrimaryActions` 给默认动作）；
- 聚焦即全选（`_selectAll`），`Ctrl/Cmd+A` 自己处理。

对应到本仓：

| VS Code | 本仓 |
| --- | --- |
| `keydown → Enter → _navigateText` | `<input onKeyDown>` 的 Enter 分支 → `submitAddress()` |
| `_suppressBlurRevert` | `suppressBlurRevertRef` |
| `_renderUrl()` on Escape | `updateDraft(formatAddress(activeUrl))` + `closeOmnibox()` |
| picker 默认动作 | `resolveAddressCommit()`：没动过列表就按输入本身解析 |
| `model.url` | `useBrowserStore` 的 `tab.url`（`browser://nav` 回灌） |

## 3. 落地改动

### 前端（`features/browser/address.ts`、`omnibox.ts`、`aside-browser.tsx`）

- `resolveAddressCommit({ text, currentUrl, highlightedUrl })` —— 唯一的提交判定：
  空输入不做；动过列表才用高亮行；目标与当前地址同一页（**保留 `#fragment`**，只抹尾部斜杠）
  返回 `reload`，其余 `navigate`。
- `isAddressDirty(draft, currentUrl)` —— 右侧按钮据此在「前往 / 刷新」之间切换。
- 输入框：Enter / Escape 显式分支、聚焦全选、blur 一次性抑制、方向键标记 `omniboxTouchedRef`。
- Enter 与「前往」走同一个 `submitAddress`；`reload` 分支调 `reloadBrowser`。

### Rust（`browser/command.rs`、`browser/lifecycle.rs`）

- `browser_navigate` / `browser_reload` / `browser_history` 改成 `async + spawn_blocking`
  （和 `browser_open` 一致：**永远不要在 IPC 回调里同步驱动 webview**）。
- `lifecycle::navigate` 两条浏览器语义：
  1. 同地址（`same_page`）→ `reload()`，兑现「敲回车 = 重新加载」；
  2. 看门狗兜底：下发前记 `read_load_generation(label)`，1.5s 后如果**一次 `on_page_load`
     都没发生**才判定被吞，用 `location.replace()` 强推一次。有加载就完全不介入，
     慢站点不会被二次导航打断。

## 4. 验证

| 项 | 结果 |
| --- | --- |
| `pnpm --filter @cogito/client type-check` | `TSC_EXIT=0` |
| `pnpm --filter @cogito/client lint` | `ESLINT_EXIT=0`（无 warning） |
| `npx vitest run src/features/browser src/views/agent/chat` | `15 files / 133 tests passed` |
| `pnpm --filter @cogito/client check:cargo` | `CARGO_EXIT=0`（仅既有 snake_case warning） |

新增用例锁语义：`resolveAddressCommit`（同地址→刷新、改地址→导航、只改 hash→导航、默认行不劫持回车、
显式选中优先、空输入为 null）、`normalizeAddressKey` / `isAddressDirty`（尾部斜杠不算改动、hash 算改动）。

## 5. 人工验收（必须用新二进制）

1. 地址栏输入任意新地址回车 → 页面真的换（日志里应有 `导航 … （原 …）`，紧跟着 `on_page_load`）；
2. 地址不改再回车 → 日志 `同地址刷新 …`，页面重新加载；
3. 聚焦地址栏直接粘贴新地址后点右侧按钮（此时是「前往」）→ 同上；
4. Esc → 输入回落成当前地址，浏览器列表不导航；
5. 慢站点（首包 2s+）连续切换 → 不应出现二次加载（看门狗只在 0 次加载时才动手）。
