/**
 * 本地规则：**catch 不许吃掉异常** —— 要么 throw 出去，要么至少输出一次。
 *
 * 注释不算数：注释不是语句，只有注释（或只写兜底 return）都过不了。
 *
 * 为什么不写成 `no-restricted-syntax`：一条规则只能有一个 severity，而 arrow-function 的禁用
 * （同一条规则）对存量文件仍按 warning 保留，两者会互相覆盖。
 */

/** 哪些调用算「输出了一次异常」：console.* / log.* / toast.* / report* / notify* / emit（事件总线） */
const REPORTING_METHOD = /^(log|error|warn|info|debug|report|notify|track|toast|emit)$/
const REPORTING_FN = /^(log|report|notify|track|warn|error)/

/** 在 catch 体里找「throw」或「输出一次」（数组/对象递归扫一遍 AST，不需要遍历器） */
function hasCatchOutput(value) {
  if (Array.isArray(value)) return value.some(hasCatchOutput)
  if (typeof value !== 'object' || value === null) return false

  if (value.type === 'ThrowStatement') return true
  if (value.type === 'CallExpression') {
    const callee = value.callee
    if (callee?.type === 'Identifier' && callee.name !== undefined && REPORTING_FN.test(callee.name)) {
      return true
    }
    const method = callee?.property?.name
    if (callee?.type === 'MemberExpression' && method !== undefined && REPORTING_METHOD.test(method)) {
      return true
    }
  }

  return Object.keys(value).some(function (key) {
    // parent 是回指（typescript-eslint 会挂上），必须跳过否则递归爆栈
    if (key === 'parent') return false
    return hasCatchOutput(value[key])
  })
}

const catchMustReport = {
  meta: {
    type: 'problem',
    docs: { description: 'catch 必须 throw 出去或至少输出一次（注释不算）' },
    schema: [],
    messages: {
      report:
        'catch 不能吞掉异常：throw 出去，或至少输出一次（console.* / log.* / toast.* / report*），注释不算数'
    }
  },
  create: function (context) {
    return {
      CatchClause: function (clause) {
        if (hasCatchOutput(clause.body.body)) return
        context.report({ node: clause, messageId: 'report' })
      }
    }
  }
}

export { catchMustReport, hasCatchOutput }
