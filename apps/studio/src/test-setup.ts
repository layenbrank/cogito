/**
 * 全局测试环境补丁。
 *
 * jsdom 没有实现 `CSS.escape`（`CSS` 命名空间本身也不存在），而设计包里的
 * 贴条 / 标尺会用它把消息 id 拼进选择器。缺了它，jsdom 环境下的渲染测试会在
 * rAF 回调里抛 `Cannot read properties of undefined (reading 'escape')`，
 * 变成「测试通过但有一堆 unhandled error」的假绿。
 *
 * 这里只补选择器转义这一件事：ASCII 标点前加反斜杠即可，覆盖 id 里常见的
 * `:` / `.` / `#` / 空格等字符。
 */
function escapeIdent(value: string): string {
  return String(value).replace(/[^\w-]/g, function (char) {
    return `\\${char}`
  })
}

type CssGlobal = { CSS?: { escape?: (value: string) => string } }

const cssGlobal = globalThis as CssGlobal

if (!cssGlobal.CSS?.escape) {
  cssGlobal.CSS = { escape: escapeIdent }
}
