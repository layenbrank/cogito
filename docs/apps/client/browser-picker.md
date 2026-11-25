# 右栏浏览器：元素拾取（CDP Overlay）

> 结论先行：拾取走 **CDP `Overlay`**（`setInspectMode → inspectNodeRequested`），
> **不向页面注入高亮框**。点击拾取按钮到「hover 就出框」之间**只允许一次 CDP 往返** ——
> 这一点由「tab 建好就预热」保证，见 §3。

## 1. 链路

| 步骤  | 谁做               | 关键点                                                                                                  |
| ----- | ------------------ | ------------------------------------------------------------------------------------------------------- |
| 准备  | `picker::warm`     | `Overlay.inspectNodeRequested` 订阅 + `DOM.enable` + `Overlay.enable`，**在 tab 建好时**做完            |
| 开始  | `picker::start`    | 置 active → `Overlay.setInspectMode(searchForNode)`；有设备模拟时才多一趟 `suspend_mouse`               |
| hover | Chromium           | 系统高亮（`highlightConfig`：content/padding/border/margin 四色，`showInfo` 带标签）                    |
| 点击  | 主线程回调         | `Overlay.inspectNodeRequested` → `on_inspect_requested`（`busy` 闸门只放一次）                          |
| 抽取  | `extract_and_emit` | `DOM.resolveNode` → `Runtime.callFunctionOn(EXTRACT_FN)`（selector / text / outerHTML / rect + 滚动量） |
| 截图  | `capture_clip`     | `quiesce_overlay` 撤掉高亮 + 等两帧 → 文档坐标 clip 再乘当前 zoom，`Page.captureScreenshot`            |
| 收尾  | `picker::stop`     | `setInspectMode(none)` + `hideHighlight`，有设备时 `emulate::resume_mouse`                              |

产物 `PickedElement` 通过 `browser://element-picked` 发给主窗，前端 `attachPickedElement` 把它
（含截图）挂进 composer；active 状态经 `browser://element-picker-active` 双向对齐。

## 2. 为什么截图里不能带高亮

`Page.captureScreenshot(fromSurface: true)` 抓的是**合成后的 surface**，而 Overlay 的高亮正好画在
这一层 —— 截图时如果 inspect 模式还开着，选中的元素截图会自带「正在被选中」的蓝色填充 + 黑框，
看上去像页面自己的配色。所以 `capture_clip` 先 `quiesce_overlay`：

1. `Overlay.setInspectMode(none)`（退出 inspect）；
2. `Overlay.hideHighlight`（立刻清框）；
3. `Runtime.evaluate` 等**两帧**（清理也是在渲染帧里生效的），并且这行 Promise **必须带超时兜底**：
   页面被遮挡 / 刚切回页面视图时 `requestAnimationFrame` 根本不跑，`awaitPromise` 会一直挂到
   CDP 超时（10s），表现就是「点了元素，十几秒才出结果」。

## 3. 延迟预算：预热（这一轮修的就是它）

以前 `start()` 把五件事串在一起：

```text
ensure_subscribed（同步阻塞，等主线程真装上接收器）
→ emulate::suspend_mouse（CDP 往返）
→ DOM.enable（往返；浏览器侧要为整篇文档建节点索引）
→ Overlay.enable（往返）
→ Overlay.setInspectMode（往返）
```

实测点击到高亮跟手要 **1~2 秒**。这段时间前端已经把按钮画成「拾取中」（乐观 UI），用户的
hover 全落在「armed 但还没生效」的窗口里 —— 看起来就是「选了拾取要等一下才好使」。

现在的分工：

| 时机                                | 做什么                                                        | 代价                     |
| ----------------------------------- | ------------------------------------------------------------- | ------------------------ |
| tab 建好（`lifecycle::open_inner`） | `picker::warm`：订阅 + `DOM.enable` + `Overlay.enable`        | 一次性，且与页面加载重叠 |
| 点按钮（`picker::start`）           | `Overlay.setInspectMode`（桌面态就这一趟）                    | 一次往返                 |
| 有设备模拟                          | 多一趟 `suspend_mouse`（关掉鼠标 → touch 合成，hover 才跟手） | 一次往返                 |
| `start` 里 `arm` 失败               | 重开一次域再 arm（预热状态过期时自愈）                        | 只在异常路径             |

细节：

- **桌面态不再发 `suspend_mouse`**：没有设备就没有 `setEmitTouchEventsForMouse` 覆盖，
  多发一趟只是白等一个往返（`emulate::has_device` 判据）。
- **先置 active 再 arm**：反过来时，armed 到 active 落位之间那一下点击会被
  `on_inspect_requested` 当成「不在拾取」丢掉，表现为「第一下点了没反应」。
- **账本用 remove 而不是 insert(false)**：label 是 UUID，`insert(false)` 会让每个关掉的 tab
  在 `active` / `busy` 里留一行永远清不掉的记录。关 tab / 孤儿清理走 `picker::forget`
  （连 `subscribed` / `warmed` 一起清）；**导航**只走 `dispose_label`，CDP 接收器挂在 webview 上、
  导航后仍然有效，必须保留预热状态。

## 4. 已否定方案：把高亮框注入页面（自绘）

参考 `vueuse/useParentElement` 那种「自己画一个框跟着指针走」的思路，在本仓**不成立**：

- 右栏页面是**窗口级原生子 webview**，永远画在 HTML 之上（见 [browser-overlay.md](./browser-overlay.md)）。
  App 侧任何 div 都盖不住页面元素，除非先把页面藏掉 —— 那也就没法拾取了；
- 唯一可行的注入版是「在页面里注入 `position: fixed` 框 + `pointermove/click` 拦截 +
  `Runtime.addBinding` 回传 + 自己处理 shadow DOM / OOPIF 穿透」—— 那是把 CDP Overlay 重写一遍，
  只换来视觉统一，而「截图干净」已由 `quiesce_overlay` 解决。

## 5. 日志与验证

改动 picker 后在 dev 实例里点一次拾取，日志里应有：

```text
[INFO][cogito] browser: 拾取预热完成（browser-<uuid>，NN ms）     ← tab 建好后不久
[INFO][cogito] browser: 元素拾取就绪（browser-<uuid>，N ms）       ← 点按钮，个位数毫秒
[INFO][cogito] browser: 元素拾取完成（browser-<uuid>，<tag>，NN ms，截图=true）
```

人工验收：

1. 打开一个页面 → 立刻点拾取 → **鼠标一动就应出框**（不再等一下）；
2. 点一个元素 → 结果进输入框，截图里**没有**蓝色高亮；
3. 开设备模拟后再拾取 → 高亮同样跟手（合成 touch 已被临时关掉），结束后设备模拟状态不变；
4. 导航后立刻再拾取 → 同样跟手（`arm` 失败会自动重开域）。

单测：`cargo test --lib browser::picker` 覆盖 UTF-8 截断与「账本不留残渣」
（`forget_and_release_busy_leave_no_residue`）。
