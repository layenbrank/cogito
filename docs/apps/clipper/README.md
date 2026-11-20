# @cogito/clipper

Cogito 扩展的**剪藏弹窗**（Chrome / Chromium MV3 的工具栏弹窗），与 `apps/extension` 一起打包成**同一个扩展**。

## 三个包怎么分工

| 位置 | 职责 | 产物 |
| --- | --- | --- |
| `apps/extension` | 唯一打包的扩展：一个 `manifest.json`、一个 `background.service_worker`、新标签页与侧栏 | `apps/extension/dist`（清空） |
| `apps/clipper`（本包） | 只做剪藏弹窗这一页（React + Vite） | `apps/extension/dist/popup.html` + `assets/*`（不清空） |
| `packages/extension-kit` | 剪藏协议（端口 / 消息 / Markdown / 投递）、页面抽取，以及 service worker 里要装的那半 `installClipRelay()` | 无独立产物，被上面两者引用 |

三者各自构建、互不清空对方产物。`pnpm --filter @cogito/extension build` 的顺序是
`build:core`（扩展本体 + `service-worker.js`）→ `build:clip`（本包，`pnpm --filter @cogito/clipper build`）→ `build:post`（manifest 收尾）。

**为什么 worker 在 extension 而不是这里**：MV3 一个扩展只允许一个 `background.service_worker`。
`apps/extension/src/entries/worker.ts` 是唯一入口，它在顶层把「右键固定到新标签」（扩展自己的）
与 `installClipRelay()`（剪藏那半）一起装上 —— 监听器必须同步注册，否则 worker 被唤醒时事件可能先到。

## 剪藏链路

```
弹窗「剪藏当前页」
  --chrome.runtime.sendMessage({ type: 'clip-active' })-->
    service worker：chrome.scripting.executeScript 抽 body.innerText
      → POST http://127.0.0.1:19828/clip（失败再试 19829，记住上次成功的端口）
        → client 落盘 raw/sources/*.md 并入 ingest 队列
```

- 不再有跨扩展消息：以前要 `externally_connectable` + 在两个弹窗里手填对方的扩展 ID，
  现在都在同一个扩展内，manifest 也不声明 `externally_connectable`；
- 权限：`scripting`（注入抽取函数）+ `activeTab`（点工具栏图标即授予，够弹窗这一次用）；
  `host_permissions` 只留本机 client 的 19828 / 19829，不申请 `http://*/*`；
- 上次结果由 worker 写进 `chrome.storage.local`（`cogito.clip.delivery`），弹窗每次打开复述一遍。

## 开发

```bash
pnpm --filter @cogito/clipper type-check
pnpm --filter @cogito/clipper dev      # vite build --watch，持续写入 apps/extension/dist
pnpm --filter @cogito/extension build  # 先扩展本体、再本包、最后收尾 manifest
```

装扩展：`chrome://extensions` → 开启开发者模式 → 「加载已解压的扩展程序」→ 选 `apps/extension/dist`。
