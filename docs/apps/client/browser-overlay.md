# 右栏浏览器：浮层让位（「历史列表只在没开标签页时可见」的正解）

> 结论先行：右栏页面是**窗口级原生子 webview**，永远画在 HTML 之上。所以**任何**
> 压在页面上的 HTML（下拉、建议列表、菜单、悬浮框、通知、对话框）都必须让页面让位：
> 先截一帧 → 截图铺满占位区 → 再 `visible(false)` 藏掉原生层。
> 「让位」不是逐处记得打标记的事，而是**判定问题**：谁画在上面，谁就该触发让位。

## 1. 现场症状

地址栏聚焦 / 输入时，建议列表里有「历史记录」「本页历史」「导航磁贴」三组行。实际：

| 场景 | 现象 |
| --- | --- |
| 没有打开任何标签页（没有 webview） | 列表正常显示，历史记录能用 |
| 打开任意标签页（有 webview） | 列表**整块看不见**，只有页面；看起来像「历史记录只有没开标签页时才有」 |

根因不是取数，也不是 z-index：那个 `<ul>` 是**手写浮层**，没有声明 `data-webview="false"`，
于是 `useBrowserRect` 的遮挡判定认为「页面上没有东西」，原生层保持可见，把列表盖住了。
（design 包的 `DropdownMenu / Popover / Dialog / Select / Combobox` 自带这个标记，
手写浮层必须自己加 —— 漏一处就是「功能看起来没做」。）

## 2. VS Code 的标准做法（实读源码）

目录：`src/vs/workbench/contrib/browserView/electron-browser/`。VS Code 也把页面放在
Electron 的原生层（`WebContentsView`）里，所以它面对同一个「HTML 盖不住原生层」的问题，
解法分三块：

### 2.1 `overlayManager.ts` —— 谁画在上面，由 hit-test 决定

- 维护一份**浮层清单**（`OVERLAY_DEFINITIONS`）：`monaco-menu-container` /
  `action-list-submenu-panel`（菜单）、`quick-input-widget`（quick pick，地址栏建议列表就是它）、
  `monaco-hover` / `editor-widget` / `suggest-details-container`（悬浮）、
  `monaco-dialog-modal-block`（对话框）、`notifications-center` / `notification-toast-container`（通知）、
  `context-view`（通用浮层）；
- `MutationObserver`（`childList` + 每个浮层元素的 `style` / `class`）盯增删与挪位，
  结构一变就重算；
- `getOverlappingOverlays(element)`：先算浮层与元素的**矩形相交中心点**，再用
  `elementFromPoint` 做 **z 序复核** —— 只有「那一点上真正画在最上面的就是它」才上报。
  命中链里要跳过 `context-view-block`（全屏拦截层）与 webview 自身图层；
- 事件 `onDidChangeOverlayState` 只发状态变化。

要点：判定是**几何 + z 序**，不是「谁记得上报自己」。

### 2.2 `webContentsViewHost.ts` —— 让位的状态机

- `_shouldShowPage() = editorVisible && !overlayObscured && !hiddenAsAnchor && url && !error`；
- `_refreshOverlayObscured()` 拿 `getOverlappingOverlays(container)`，一有遮挡就把
  `_overlayObscured = true` → `_refresh()`；
- 让位流程：`_captureScreenshot()` → 写进 `.browser-placeholder-screenshot` 的
  `background-image` → 下一帧（`requestAnimationFrame`）才 `model.setVisible(false)`；
  这样**占位图先上屏，原生层后撤**，不会闪白；
- 恢复：`setVisible(true)` 之后才拆占位；
- `_captureScreenshot()` 在页面可见期间**每 1s 重拍一帧**（还有 `onDidNavigate` /
  `onDidChangeLoadingState` / `onDidChangeVisibility` 触发重拍），所以缓存帧不会过期；
- 另有一条 `registerOverlayAnchor`：容器被 transform 拖动/隐藏时，页面不跟着动 →
  直接按不可见处理（`hiddenAsAnchor`）。

### 2.3 `media/browser.css` —— 让位时的视觉

- `.browser-overlay-paused`：`background-color: color-mix(editor-background 15%, transparent)`，
  `opacity` 渐变 200ms —— **压暗只有 15%**；
- 只有**通知**类浮层才 `show-message`（60% 压暗 + 「Paused due to Notification」文字）。

### 2.4 `widgets/browserUrlBarWidget.ts` —— 地址栏本身

地址栏编辑面是 **quick pick**（`createQuickPick`，`anchor = 地址容器`、
`anchorPosition = 'overlay'`），即建议列表本身就是被 track 的 `quick-input-widget`，
所以列表一开，页面自然让位：

- 打开时机：Tab 聚焦 / 鼠标首次点击（`click` 里 `_openPicker`）/ 直接输入（`input` 事件）
  —— **不是**聚焦即开；
- 列表首行永远是 `getPrimaryActions(text)` 给的默认动作（Search / Go to），
  provider 建议**永远不自动高亮**（`picker.sortByLabel = false` + 显式 `activeItems`）；
- Enter 直接提交**用户输入**（`_navigateText`），只有显式选中建议才用建议项；
- `_suppressBlurRevert` 抑制提交后那次 blur 的回落；Esc 走 `_renderUrl()` 回 canonical URL。

## 3. 本仓对齐

### 3.1 判定：`apps/client/src/features/browser/overlay-cover.ts`（新增）

`findCoveringOverlay(surface)` 两条路：

| 顺序 | 规则 | 说明 |
| --- | --- | --- |
| 1 | 显式标记 `data-webview="false"` 且与占位区相交 | 快路径；`@cogito/design/lib/webview-cover` 是唯一契约 |
| 2 | **hit-test 兜底**：占位区 3×3 采样点 → `document.elementsFromPoint`，命中链里出现「不是占位区、不在占位区里、也不是占位区祖先」的元素 | 对应 VS Code 的 `getOverlappingOverlays`；手写浮层漏标记也能被发现 |

走到占位区的**祖先**就停（说明这点上占位区已经是画面最上层）；`visibility: hidden` /
`display: none` / `pointer-events: none` 视为穿透。

开发态命中「没打标记」的浮层时 `console.warn('[browser/rect] 浮层没打 data-webview="false"…')`
（同一元素只提示一次），把「以后再加浮层」的坑显性化。

### 3.2 让位状态机：`apps/client/src/features/browser/rect.ts`

- 判定换成 `findCoveringOverlay`；
- `MutationObserver` 的 `attributeFilter` 增补 `style` / `class`：浮层挪位置只改这两个属性
  （VS Code 的观察器同款），`tick` 用 rAF 合并；
- rect 上报加 `0.5px` 去重，避免 hover 级重排把 IPC 打满；
- 缓存帧**保鲜**：页面重新露出来后（`leavePause` 尾部）补拍一帧，间隔 ≥1s；
  以前只在第一次暂停时拍，导航后再开菜单会看到**上一页的旧画面**；
- 进入 / 离开的次序保持不变（占位先 paint → 再 hide；先 show → 再拆占位）。

### 3.3 视觉：`aside-browser.tsx`

- 让位压暗 `bg-background/55` → `bg-background/15`，对齐 VS Code 的 15%；
- 建议列表 `<ul>` 补 `{...webviewCoverProps()}`（显式标记，快路径）；
- 顺带把「地址栏建议列表」这条回归写进注释，避免以后又被当成纯样式删掉。

## 4. 约定（新写浮层时）

1. 用 design 包的 `DropdownMenu / Popover / Dialog / Select / Combobox` —— 自带标记；
2. 手写浮层（自定义 `<ul>` / 绝对定位面板 / 悬浮卡片）**必须**加
   `{...webviewCoverProps()}`（`@cogito/design/lib/webview-cover`）；
3. 纯装饰、不需要交互的图层用 `pointer-events-none`，会被判成穿透（不会白让位）；
4. 只有「视觉上真的压着页面」才需要让位；单纯加 `z-index` 在原生层面前无效。

## 5. 验证

| 项 | 结果 |
| --- | --- |
| `npx vitest run src/features/browser src/views/agent/chat` | `16 files / 145 tests passed`（新增 `overlay-cover.test.ts` 12 例） |
| `npx tsc --build --force` | 无输出（通过） |
| `npx eslint <4 个改动文件>` | 无输出（通过） |

新增用例锁的行为：标记相交 → 遮挡；标记但不相交 / 穿透 → 不算；**未标记的手写浮层
hit-test 能认出**；命中链是占位区自身或其子节点 / 祖先 → 不算；尺寸为 0 不做采样；
`hasCoverMarker` 认祖先标记；采样点 3×3 与窄尺寸退化。

人工验收（要新二进制）：

1. 打开一个标签页 → 点地址栏 → **历史记录列表要能看见**（且页面变成 15% 压暗的静止帧）；
2. 选一行 → 页面恢复，列表消失；
3. 导航到新页面后再点地址栏 → 静止帧应该是**当前页**，不是上一页；
4. 打开设备下拉菜单 → 页面同样让位，菜单可点；
5. 关掉列表 / 失焦 → 页面重新动起来（不再停留在静止帧）。
