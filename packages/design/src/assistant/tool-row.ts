/**
 * 对话里「默认折叠的工具行」只有一个高度：28px（`h-7`）。
 *
 * 一次回答里常有几十次工具调用。只要某一行因为图标 / 耗时 / 状态多带一点内边距，
 * 行高就会参差不齐，读起来像排版坏了 —— 所以折叠行的高度写成**常数**，
 * 而不是「padding + 行高凑出来的」。这里是唯一源：
 *
 * - `ToolFallback.Trigger`（`tool-fallback.aui.tsx` 的 `TOOL_TRIGGER_ROW_CLASS` 直接复用它）
 * - 命令工具卡的 `$ 命令` 行（client `tool-card-terminal-body.tsx`）
 * - `CodeDiff` 的标题栏（写文件卡的折叠行）
 *
 * 不要改回 `py-*` 之类的「凑高度」写法：单测锁的就是这个常量。
 */
export const TOOL_ROW_HEIGHT_CLASS = 'h-7'

/** 同一口径的像素值，给需要写死尺寸的地方（单测断言 / 固定高度容器）用 */
export const TOOL_ROW_HEIGHT_PX = 28
