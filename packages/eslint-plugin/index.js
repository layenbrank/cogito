/**
 * @cogito/eslint-plugin —— 仓库内自用的 ESLint 规则（studio / client 共用同一份）。
 *
 * 命名空间固定 `ith`：规则 id 形如 `ith/catch-must-report`。
 */
import { catchMustReport } from './rules/catch-must-report.js'

const plugin = {
  meta: {
    name: '@cogito/eslint-plugin',
    version: '0.0.1'
  },
  rules: {
    'catch-must-report': catchMustReport
  }
}

export default plugin
