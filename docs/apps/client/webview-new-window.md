# 子页面新窗口：留在应用内

> 记录 Windows 子 WebView 里 `target=_blank` / `window.open` 的已知问题与当前解法。
> 改 `navigation/command.rs` 或 `vendor/wry` 的 `NewWindowRequested` 之前，先读本文。

子页面用 `WebviewBuilder` + `Window::add_child` 创建。版本：tauri 2.12.4，`webview2-com =0.39.1`。wry 0.57.0 经 Cargo `[patch]` 指向 `apps/client/src-tauri/vendor/wry`。

---

## 1. 速查

| 目标 | 当前做法 | 不要这样做 |
|------|----------|------------|
| http/https 新窗口变成「网址」标签 | 页面脚本 `postMessage` 成功后，宿主发已有的 `navigation://open-url` | 只靠 `on_new_window` 返回 `Deny` |
| 系统浏览器不出现 | `postMessage` 成功才 `preventDefault`；wry 在事件返回前 `SetHandled(true)` 且不再 `GetDeferral()` | 先取消点击，再指望消息把页面打开 |
| 同页链接 | 无 `target`，或 `_self` / `_parent` / `_top`，脚本不拦截 | 在 `NavigationStarting` 里取消普通跳转 |
| 非 http/https | 取消新窗口，不调用系统 opener | 把 `javascript:` 或自定义协议交给 opener |

**关键实现**

- 脚本与事件：`apps/client/src-tauri/src/navigation/command.rs`（`OPEN_URL_SCRIPT`、`bind_open_url`、`bind_external`、`on_new_window`）
- wry 后备：`apps/client/src-tauri/vendor/wry/src/webview2/mod.rs` 的 `NewWindowRequested`
- 侧栏：`apps/client/src/views/overview/browser/chrome.tsx` 监听 `navigation://open-url`

---

## 2. 问题

在 Windows WebView2 子页面里，下面几种操作会打开系统默认浏览器：

- `a[target=_blank]`
- 中键点击、Ctrl / Meta / Shift 点击
- `window.open`
- `target=_blank` 的表单提交

应用内应出现对应的「网址」标签。同页导航保持原样。

---

## 3. 为什么 `on_new_window` 不够

`NewWindowResponse::Deny` 只在 wry 真正把 `Handled` 定下来之后才有用。WebView2 在事件返回、并且没有未完成的 deferral 时才认 `Handled`。

wry 0.57.0 上游的 `NewWindowRequested` 先 `GetDeferral()`，再用 `PostMessage` 把 `Allow` / `Create` / `Deny` 推迟到下一轮消息。推迟是为了避免 `NewWindowResponse::Create` 在回调里新建 WebView 时重入死锁（[wry#1601](https://github.com/tauri-apps/wry/pull/1601)）。返回时请求仍未处理，系统浏览器已经打开。相关讨论见 [tauri#15872](https://github.com/tauri-apps/tauri/issues/15872)、[tauri#14090](https://github.com/tauri-apps/tauri/issues/14090)。升级到 wry 0.57 没有把 `SetHandled` 挪回回调返回前。

两条走不通的捷径：

- 不注册 `on_new_window` 时，wry 同步 `SetHandled(true)`。浏览器不开，地址也拿不到，点击被吞掉。
- 只在 `GetDeferral()` 之前 `SetHandled(true)` 仍不够。deferral 未完成时，决定被推迟，先前的 `true` 不生效。

---

## 4. 失败过的做法

页面脚本直接 `preventDefault`，并替换 `window.open`，但 `postMessage` 没有把页面打开。结果是既不外跳，也不在应用内打开。这段逻辑（当时叫 `BLANK_GUARD`）已删除，不要加回去。

取消默认动作之前，宿主必须已经能发出 `navigation://open-url`。

---

## 5. 当前做法

两层一起生效。单独靠 wry 的 `SetHandled(true)` 没有拦住用户看到的外跳，脚本才是打开「网址」标签的路径。

**页面脚本**（`OPEN_URL_SCRIPT`，所有 frame 在文档创建时注入）

1. 识别新窗口：`target` 不是空、`_self`、`_parent`、`_top`，以及中键和 Ctrl / Meta / Shift 点击；另外包装 `window.open` 和 `target=_blank` 的表单提交。
2. http/https：`window.chrome.webview.postMessage("i-thinking:open-url:" + href)`。`bind_open_url` 收到前缀后调用 `emit_blank_url`，向主窗口发送 `navigation://open-url`。侧栏把它收成「网址」标签。
3. 只有 `postMessage` 成功才 `preventDefault`。`chrome.webview` 不存在时返回 `skip`，不取消点击。
4. 非 http/https 的新窗口直接取消，不调用系统 opener。

**wry 后备**

`NewWindowRequested` 一进来就同步 `SetHandled(true)`，不再 `GetDeferral()`。随后的 `on_new_window` 仍返回 `Deny`，延后回调不能把 `Handled` 改回 `false`。该回调仍会发一次 `navigation://open-url`；脚本已经取消点击时，这个事件不会再来。

**外部协议**

`bind_external` 监听 `LaunchingExternalUriScheme`，`SetCancel(true)`。地址能解析成 http/https 时同样走 `navigation://open-url`。

---

## 6. 改完之后

已打开的子页面要重新打开，才会带上新脚本。改了 Rust（含 `vendor/wry`）之后，先完全退出进程，再启动 `tauri dev`。正在运行的 `i-thinking.exe` 仍是旧二进制，并且会锁住 sidecar，默认编译目录会报「拒绝访问」。
