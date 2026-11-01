/** 操作栏行高（与 omnibar / 窗控同列）。 */
const SHELL_BAR = 56

/** 顶栏控件边长：与 omnibar 外壳 `h-9`（36px）对齐 */
const SHELL_CONTROL = 36

/**
 * 贴边遮罩避开 Caption（`top-14` = 3.5rem = 56px）。
 * 默认弹层走 ShellOverlayHost，不必手写；非 shell 树可选用。
 */
const BELOW_SHELL = 'top-14! bottom-0! h-auto!'

export { BELOW_SHELL, SHELL_BAR, SHELL_CONTROL }
