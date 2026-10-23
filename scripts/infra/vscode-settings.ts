// 把 `.vscode/settings.json`（唯一真相）同步进 `cogito.code-workspace` 的 `settings` 段。
//
// 为什么必须有两份：
//   多根工作区里，每个 folder 的文件只吃**它自己那个 folder** 的 `.vscode/settings.json`
//   （root 与 apps/* 是并列/嵌套的 folder，互不继承 —— 见 VS Code 官方「Multi-root Workspaces →
//   Settings」：folder settings 只对那个 folder 生效）。而 `.code-workspace` 的 `settings`
//   对**所有** folder 生效。所以：仓库设置写在 `.vscode/settings.json`，
//   工作区那份由本脚本生成，**不要手改**。
//
// 唯一改写：`${workspaceFolder}` → `${workspaceFolder:cogito}`。工作区文件里必须给变量
// 指定 folder 名（官方要求），而单根模式下的 `.vscode/settings.json` 用裸 `${workspaceFolder}`。
// 已有的 `${workspaceFolder:client}` 这类别名不受影响。
//
// `.vscode/{launch,tasks,mcp,extensions}.json` 不进工作区文件：VS Code 会到各 folder 里找它们，
// root 是 folders 的第一个，所以两个模式都读得到同一份，无需复制。
//
// 用法：
//   node scripts/infra/vscode-settings.ts          # 同步（写盘）
//   node scripts/infra/vscode-settings.ts --check  # 只校验是否已同步（提交前/CI）

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sourcePath = join(repoRoot, '.vscode', 'settings.json')
const targetPath = join(repoRoot, 'cogito.code-workspace')

/** root folder 的名字：`${workspaceFolder:<name>}` 里的 name 必须与它逐字一致。 */
const ROOT_FOLDER = 'cogito'

/**
 * 聚焦视图；`cogito` 必须排第一，根目录的设置与 launch/tasks/mcp 才会被读到。
 * 这些 app/package 只是「视图」，不是独立仓库。
 */
const folders = [
  { name: 'cogito', path: '.' },
  { name: 'extension', path: 'apps/extension' },
  { name: 'client', path: 'apps/client' },
  { name: 'devtools', path: 'apps/devtools' },
  { name: 'service', path: 'apps/service' },
  { name: 'docs', path: 'docs' },
  { name: 'shared', path: 'packages/shared' }
]

/** JSONC → 对象：只剥「整行注释」，够用且不会误伤字符串里的 `//`。 */
function parseJsonc(text: string): Record<string, unknown> {
  const stripped = text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
  return JSON.parse(stripped) as Record<string, unknown>
}

function render(): string {
  const settings = parseJsonc(readFileSync(sourcePath, 'utf8'))
  const body = JSON.stringify({ folders, settings }, null, 2).replaceAll(
    '${workspaceFolder}',
    `\${workspaceFolder:${ROOT_FOLDER}}`
  )
  const header = [
    '// 由 scripts/infra/vscode-settings.ts 生成，请勿手改。',
    '// 设置源：.vscode/settings.json（改完跑 `node scripts/infra/vscode-settings.ts`）',
    ''
  ].join('\n')
  return `${header}${body}\n`
}

function firstDifference(current: string, expected: string): string {
  const a = current.split(/\r?\n/)
  const b = expected.split(/\r?\n/)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `第 ${i + 1} 行：\n  磁盘：${a[i] ?? '(缺)'}\n  期望：${b[i] ?? '(缺)'}`
  }
  return '（内容相同但换行符不同）'
}

const expected = render()
const checkOnly = process.argv.includes('--check')

/**
 * 工作区文件写 CRLF：仓厈 checkout 就是 CRLF（`core.autocrlf=true`，与 prettier 的
 * `endOfLine: crlf` 一致），用 LF 会每次生成都报「LF will be replaced by CRLF」。
 * （`--check` 比对时会先归一化行尾，所以编辑器重存也不会被当成“分叉”。）
 */
function withCrlf(text: string): string {
  return text.split('\n').join('\r\n')
}

/** 比对时忽略行尾，避免换行符差异被当成“分叉”。 */
const normalize = (text: string): string => text.replaceAll('\r\n', '\n')

if (!checkOnly) {
  writeFileSync(targetPath, withCrlf(expected), 'utf8')
  console.log(`已同步 → cogito.code-workspace（${expected.split('\n').length} 行）`)
} else {
  let current = ''
  try {
    current = readFileSync(targetPath, 'utf8')
  } catch {
    console.error('缺少 cogito.code-workspace，请先跑：node scripts/infra/vscode-settings.ts')
    process.exit(1)
  }
  if (normalize(current) === expected) {
    console.log('cogito.code-workspace 与 .vscode/settings.json 已一致')
  } else {
    console.error('两份设置已分叉：\n' + firstDifference(normalize(current), expected))
    console.error('\n修正：node scripts/infra/vscode-settings.ts')
    process.exit(1)
  }
}
