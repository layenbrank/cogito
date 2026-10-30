import type { Rule } from 'eslint'

/**
 * `@cogito/eslint-plugin` 规则：
 * - `catch-must-report`：catch 必须 throw 或至少输出一次
 * - `no-scrollbar-width-thin`：禁止 scrollbar-width: thin / scrollbar-thin
 */
declare const plugin: {
  meta: { name: string; version: string }
  rules: {
    'catch-must-report': Rule.RuleModule
    'no-scrollbar-width-thin': Rule.RuleModule
  }
}

export default plugin
