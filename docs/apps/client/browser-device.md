# 右栏浏览器：设备模拟（H5 移动端调试）

给右栏内嵌浏览器加一层「设备」：页面按设备的 CSS 尺寸布局，带移动端 UA / `pointer: coarse` /
touch 事件 / DPR，预览区等比缩放到面板里；退出即恢复桌面态。

**为什么不能靠 DevTools**：WebView2 自带的 DevTools 前端被裁掉了设备工具栏（只剩
「设置 → Devices」一页，能加设备但应用不了），所以尺寸 / DPR / 触摸 / UA 只能宿主侧下发 ——
这也是 `browser/cdp.rs` 存在的原因，设备模拟只是又一条 `Emulation` 消费者。

## 分层：前端出尺寸，后端出语义

| 层   | 谁做                 | 关键点                                                                                                                 |
| ---- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 盒子 | `aside-browser.tsx`  | 占位节点改成「设备 CSS 尺寸 × fit」并居中；原生子 webview 无法被 CSS `transform` 缩放，**只能让它真的变小**            |
| 布局 | `browser/emulate.rs` | `Emulation.setDeviceMetricsOverride`：让页面按 393×852 布局，断点才准确                                                |
| 缩放 | 同上                 | `scale: fit`（CDP 通道）或 `webview.set_zoom(fit)`（zoom 通道）                                                        |
| 语义 | 同上                 | `setTouchEmulationEnabled` + `setEmulatedMedia(pointer/hover)` + `setEmitTouchEventsForMouse` + `setUserAgentOverride` |
| 状态 | `browser/state.rs`   | Rust 按 label 持有 `BrowserTab.device`，随 `browser_snapshot` 回灌前端                                                 |

`fit = min(1, 面板宽/设备宽, 面板高/设备高)`，两侧都夹在 `0.1..1`。

## 设备档案 → CDP 参数

| 字段               | 去处                                                               | 备注                                                                                                |
| ------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `width` / `height` | `metrics.width` / `height` + `screenWidth/screenHeight`            | CSS px；同时决定 `screenOrientation`                                                                |
| `dpr`              | `metrics.deviceScaleFactor`                                        | `null` → 传 `0` = 不覆盖（桌面预设用）                                                              |
| `mobile`           | `metrics.mobile` + `setTouchEmulationEnabled` + `setEmulatedMedia` | `true` 时 `pointer: coarse` / `hover: none`，并合成触摸                                             |
| `userAgent`        | `setUserAgentOverride`                                             | 同时补 `userAgentMetadata`（否则 `navigator.userAgentData.mobile` 仍是桌面值）；`null` 时发空串复位 |

预设（前端 `features/browser/device.ts` 与后端 `emulate::preset()` **各存一份**，字段必须一致）：

| id              | 尺寸     | DPR      | mobile |
| --------------- | -------- | -------- | ------ |
| `iphone-15-pro` | 393×852  | 3        | ✓      |
| `iphone-se`     | 375×667  | 2        | ✓      |
| `pixel-8`       | 412×915  | 2.625    | ✓      |
| `ipad-mini`     | 768×1024 | 2        | ✓      |
| `android`       | 360×780  | 3        | ✓      |
| `desktop`       | 1440×900 | 跟随系统 | ✗      |

> 桌面预设的 `dpr` 是「不覆盖」而不是 1：强制 1 会让 125% 缩放的机器上 1px 边框和真实桌面不一致。

## 缩放通道的三级降级

`Emulation.setDeviceMetricsOverride.scale` 在 WebView2 上不一定被接受，所以：

1. **cdp**（默认）：`metrics.scale = fit`，一次调用同时定布局与缩放（与 DevTools 同路径）。
2. **zoom**：`apply()` 发现带 `scale` 的调用被拒，自动**改走** `webview.set_zoom(fit)` 并改写全局通道 —— 不需要用户先去点一次自检。
3. **none**：`Emulation.canEmulate` 也为假时，只提示「面板太窄 / 环境不支持」，页面会被裁剪。

自检（工具栏 ⚡）会跑一次真实覆盖并读回 `innerWidth / dpr / pointerCoarse`，
结果里的 `emulation.scaleChannel` 就是当前通道；UI 只显示、不猜。

## 状态：Rust 是真相源

- `BrowserTab.device`（`state.rs`）随 `browser_snapshot` 回灌前端，页面刷新 / HMR 后工具栏不会停在「桌面」。
- **硬导航会重置 per-target override**：`lifecycle.rs` 的 `on_page_load` 里 spawn 一次 `emulate::replay`。
- 前端算的 `fit` 存在 `emulate::fits`（按 label）：导航重放、拾取恢复都用它，Rust 不重复算。
- tab 关闭 / 孤儿清理 → `emulate::forget(label)`。
- agent 改了设备后调 `lifecycle::broadcast`：前端拿到新 `tab.device` 会按自己的面板尺寸重算 fit。

## 与拾取 / 截图 / 网络的口径

- **拾取**：`setEmitTouchEventsForMouse` 会把鼠标事件合成 touch，hover 态失效 → `Overlay` 高亮不跟手。
  所以 `picker::start()` 先 `emulate::suspend_mouse()` 关掉合成，`picker::stop()` 再按设备 `resume_mouse()`。
- **截图**：`Page.captureScreenshot` 走 CSS px，元素 clip 不用按 fit 折算。DPR 3 时整页 jpeg 会大三四倍，
  `agent::screenshot` 在超过阈值时按 CSS px 再拍一张，**只有真的更小才采用**（用体积当判据，不赌 `clip.scale` 的语义）。
- **网络**：与设备无关 —— 只在 UA 覆盖后会看到服务端按移动端下发的内容，这正是模拟的本意。

## agent 工具

`app_browser_device`（effect = **write**）：

```json
{
  "preset": "iphone-15-pro",
  "width": 360,
  "height": 780,
  "dpr": 3,
  "mobile": true,
  "userAgent": "...",
  "off": true
}
```

`preset` 与 `width + height` 二选一；返回里带 `readback`（页面自报的视口）与 `scaleChannel`。
只读审批档下 agent 不能自己切设备（预期行为）。

## 红线：不动 WebView2 profile

`emulate` 只走 CDP 与 `set_zoom`，**不碰** `data_directory` / `additional_browser_args`
（见 `browser/mod.rs` 头注）。给某个 tab 传这两个会让它分裂出独立 WebView2 environment，登录态不再共享。

## 已知限制

- **DPR 覆盖下预览会「糊」**：3x 渲染塞进面板物理像素里，比真机软；这是缩放预览的正常现象，不是页面 bug。
- **跨进程 iframe（OOPIF）不覆盖**：与 `picker.rs` 头注一致，首版只管主 frame。
- **UA 覆盖会改变服务端下发**：登录 / A/B 在移动 UA 下行为可能不同；UI 已写明「只作用于当前标签页，退出即恢复」。
- **agent 侧 fit 是估算**：`estimate_fit` 按上一次 fit 把盒子折回面板尺寸，随后前端按真实面板尺寸修正一次。
- 设备不跨重启记忆（`features/persist` 里没有 `browser` namespace，属后续项）。
- **模拟态下 agent 的点击走 touch 派发**：`mobile` 档案里 `setEmitTouchEventsForMouse` 会让鼠标事件被合成成 touch，
  `Input.dispatchMouseEvent(mousePressed)` 在 WebView2 上等不到完成回调（hover 只发 `mouseMoved` 所以正常）。
  所以 `browser/agent.rs::act` 的 click 分三级降级：`dispatchTouchEvent(touchStart/touchEnd)` →
  临时 `setEmitTouchEventsForMouse(false)` + 鼠标派发 → 页面内合成 `pointerdown/pointerup/click`；
  输入类 CDP 调用用 2.5s 短超时（不是全局 10s），失败不再直接抛错而是继续往下降。
  返回值的 `mode`（`touch` / `pointer` / `synthetic`）说明实际走的通道 —— 断言只看 `ok` 不够，
  要再用 `app_browser_read mode=assertText` 确认页面状态真的变了。
- **`app_browser_read` 的 `limit` 与 `maxChars` 是两件事**：`limit` 只管 `outline` 条目数（默认 60，上限 200），
  `mode=text` 的正文上限走 `maxChars`（默认 8000，上限 200000，超出时 `truncated=true`）。
  以前两者共用 `limit`，导致正文只能读回几十个字符。

## 测试可执行文件的 manifest（构建侧）

lib test 可执行文件会链进 tauri → `windows` crate，导入 `comctl32!TaskDialogIndirect`；
没有 Common Controls v6 的 manifest 时，Windows 加载器会在跑第一个用例**之前**就以
`0xc0000139`（STATUS_ENTRYPOINT_NOT_FOUND）退出，`cargo test` 只报 `test exited abnormally`。

`tauri_build::build()` 已经把这份 manifest 打进 `OUT_DIR/resource.lib`，但只发给 bins。剩下的两个
test 目标分别在 `build.rs` / `src/lib.rs` 里补：

| 目标                | 机制                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `tests/` 集成测试   | `cargo:rustc-link-arg-tests=<out>/resource.lib`                                                                    |
| lib 单测（`--lib`） | `#[cfg(all(test, target_os = "windows"))] #[link(name = "resource", kind = "static")]` + `cargo:rustc-link-search` |

别再退回「构建后手动 `mt.exe` 注入」：`cargo test` 直接就能跑。也别改成
`/MANIFESTINPUT:...manifest` + `/MANIFEST:EMBED`（那是再嵌一份，与 `resource.lib` 里已有的
MANIFEST 资源撞 `CVT1100`，bins 链接失败）。`tests/smoke.rs` 的存在是为了让 cargo 接受
`rustc-link-arg-tests`（本 crate 原本没有 `tests/` 目标）。

## 回归检查

- `pnpm --filter @cogito/client check:cargo`
- `cargo test --manifest-path apps/client/src-tauri/Cargo.toml browser::emulate`
  （manifest 由 build.rs 自动补上，直接跑即可；见上文「测试可执行文件的 manifest」）
- `pnpm --filter @cogito/client unit` / `type-check` / `lint`
- 手测：切 iPhone → `innerWidth=393`、DPR=3、`pointer: coarse`；拉宽 / 拉窄右栏只有角标百分比变；
  刷新仍保持；开拾取 hover 跟手；退出模拟后 UA 与视口复原。

## 验收清单（12 条）

设备模拟只能在**带该功能的构建**里验收 —— 关键判据是工具目录里有没有
`app_browser_device`（`GET /internal/tools/list`）。已安装的发行版（1.5.0）没有这个工具，
所以必须在 `pnpm dev:client` 的窗口里做。

桥的凭据（URL + token）写在 goose 会话库的 `extension_data` 里，可以据此**跳过 UI 直接跑批**：

```powershell
# 1) 起 dev 窗口，并在里面随便发一条消息（建 ACP 会话 → 桥凭据落库）
pnpm dev:client

# 2) 从会话库取 URL / token：sessions.extension_data → cogito.envs
#    C:\Users\iwell\AppData\Roaming\com.cogito.client\goose\data\sessions\sessions.db

# 3) 跑自动项
node tmp/device-acceptance.mjs --url http://127.0.0.1:<port> --token <token>
```

| #   | 项           | 判据                                                                             | 方式 |
| --- | ------------ | -------------------------------------------------------------------------------- | ---- |
| 1   | P0 通道      | 工具目录有 `app_browser_device`；切 iPhone 后 `innerWidth=393 / innerHeight=852` | 自动 |
| 2   | 断点         | 393 CSS px 下页面命中 `(max-width: 480px)`                                       | 自动 |
| 3   | 移动语义     | `pointer: coarse` + `hover: none`，`dpr=3`                                       | 自动 |
| 4   | 触摸         | `ontouchstart` / `maxTouchPoints > 0`                                            | 自动 |
| 5   | 拾取         | 模拟态开拾取，鼠标划过高亮跟手（`suspend_mouse` 生效）                           | 手工 |
| 6   | agent 视角   | 模拟态下 `readback` 与 `app_browser_screenshot` 都拿得到                         | 自动 |
| 7   | 导航保持     | 硬导航后视口仍是 393×852（`on_page_load` 的 replay）                             | 自动 |
| 8   | 多 tab       | 新标签页不继承上一个 tab 的设备                                                  | 自动 |
| 9   | 退出干净     | `off` 后视口 / `pointer` / UA 全部复原                                           | 自动 |
| 10  | 菜单浮层     | 设备菜单展开不被面板裁切，选中态与角标一致                                       | 手工 |
| 11  | 暂停帧不变形 | 切设备后页面按新尺寸重排，不出现拉伸 / 黑边                                      | 手工 |
| 12  | 400px 工具栏 | 右栏拉窄到 400px：工具栏不换行、角标不重叠                                       | 手工 |

夹具是 `tmp/device-fixture.html` / `tmp/device-fixture-b.html`（把视口事实 print 到 `#probe`，
第二页专门验硬导航）。
