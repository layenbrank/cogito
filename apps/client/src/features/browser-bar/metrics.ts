/** Chrome 实测的地址栏行高。登录和窗口键与地址栏同一行。 */
const BROWSER_BAR = 56

/** 顶栏控件边长：与 omnibar 外壳 `h-9`（36px）对齐，避免右侧芯片/窗口键高低错落 */
const BROWSER_CONTROL = 36

/**
 * 贴边 Sheet / 遮罩避开 Caption（`top-14` = 3.5rem = 56px，对齐 `BROWSER_BAR`）。
 * 用 `!` 压过默认 `inset-0` / `inset-y-0`，避免挡住窗口键。
 */
const BELOW_CAPTION = 'top-14! bottom-0! h-auto!'

export { BELOW_CAPTION, BROWSER_BAR, BROWSER_CONTROL }
