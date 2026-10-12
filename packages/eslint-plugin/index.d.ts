import type { Rule } from 'eslint'

/**
 * catch 不许静默吃掉异常：throw 出去，或至少输出一次。
 *
 * 认得上报通道：console.* / log.* / toast.* / report* / notify* / track / emit（事件总线）。
 */
declare const plugin: {
  meta: { name: string; version: string }
  rules: {
    'catch-must-report': Rule.RuleModule
  }
}

export default plugin
