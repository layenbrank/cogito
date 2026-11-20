# @cogito/clipper

Cogito 剪藏。Chrome / Chromium MV3 扩展，用 React 19 + TypeScript 写成。它抽取当前页，交给本机 client 落进知识库，并接受新标签扩展的剪藏请求。

包名仍是 `@cogito/clipper`。界面名称是「Cogito 剪藏」。内部按职责拆开：

| 域 | 职责 |
| --- | --- |
| `src/protocol` | 三方共用的消息名、正文格式、端口和 HTTP |
| `src/features/capture` | 注入页面的抽取函数 |
| `src/features/relay` | 投递到 client，并把结果通知 extension |
| `src/features/shell` | 弹窗 |

`apps/extension` 通过包导出 `@cogito/clipper/protocol` 使用同一套消息和健康检查，不复制正文格式。

## 三方通信

```
extension  --runtime message-->  clipper  --POST /clip-->  client
extension  --GET /health------>  client
clipper    --runtime message-->  extension（投递结果）
```

| 方向 | 通道 |
| --- | --- |
| clipper → client | `POST http://127.0.0.1:19828/clip`，失败再试 `19829`。Body：`{ title, url, markdown }` |
| clipper → client | `GET /health`。记住上次成功的端口 |
| extension → clipper | `chrome.runtime.sendMessage(clipperId, { type: "cogito:clip" })` |
| extension → clipper | `{ type: "cogito:health" }`，client 健康检查失败时的后备 |
| clipper → extension | `{ type: "cogito:clip-result", delivery }`。extension 要先把对方 ID 填在剪藏弹窗里 |
| extension → client | 弹窗直接 `GET /health`（19828，然后 19829） |

弹窗里的「剪藏当前页」仍走内部消息 `clip-active`：抽取 `document.title`、`location.href`、`body.innerText`，Markdown 头与旧版一致（`title` / `source_url` / `clipped_at`，正文最多 8 万字）。

保留的消息：

- `clip-page`：调用方已经带好 `{ title, url, markdown }`，worker 只负责 POST
- `cogito-extract`：返回 `{ title, url, markdown }`，正文规则与旧 `content.js` 相同（去掉 script / style / nav / footer / iframe，最多 12 万字）

client 成功后仍发 `knowledge://clip`，由 `features/knowledge-clip/clip-inbox.ts` 写入当前库的 `raw/sources/`。

两边扩展的 `externally_connectable.ids` 都是 `*`，只接受上表里的消息类型。第一次配对时，把各自弹窗里的扩展 ID 填到对方。

## 开发

```bash
pnpm --filter @cogito/clipper build
# 产物在 apps/clipper/dist，Chrome「加载已解压的扩展程序」选该目录
pnpm --filter @cogito/clipper dev
```

`dev` 是 `vite build --watch`。改完后在 `chrome://extensions` 里重新加载。

剪藏扩展需要能在没有自己的按钮点击时（新标签扩展发起）注入页面，所以 manifest 带了 `tabs` 和 `http/https` host 权限。正式包端口是 `19828`，隔离 dev 是 `19829`，扩展会依次探测。
