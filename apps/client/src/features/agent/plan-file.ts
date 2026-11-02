/**
 * 计划落盘：手动保存到工作区 `.cogito/plans/`。
 *
 * 格式对齐 Cursor 的 `.cursor/plans/*.plan.md`：frontmatter 只放**总结**
 * （`name` / `overview`），其余全部是**完整计划正文**。
 * 不写 `todos:` 清单：清单是正文的摘要，一旦落盘就会被当成「任务全集」读取，
 * 导致执行时漏掉正文里的文件级细节与验证步骤（见 plan-mode.md）。
 *
 * 计划默认**不**落盘，由用户点「保存」才写文件 —— 之后它可以当持久记忆、
 * PR 描述或团队共享的实现依据。
 */
import { join } from '@tauri-apps/api/path'
import { mkdir, writeTextFile } from '@tauri-apps/plugin-fs'

const PLAN_DIR = '.cogito/plans'

interface PlanFileInput {
  /** 计划标题；空则用 `计划` */
  title: string
  /** 一句话总结（`overview:` 字段） */
  overview: string
  /** 标题清单：仅在没有正文时用来拼成编号步骤（不再写进 frontmatter） */
  steps: readonly string[]
  /** 完整计划正文；为空时退化成编号步骤 */
  body: string
}

function findPlanSlug(title: string): string {
  const slug = title
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'plan'
}

/**
 * YAML 标量：普通文本原样输出，含 YAML 特殊字符时套双引号。
 * `JSON.stringify` 的产物（`"..."` 加转义）本身就是合法的 YAML 双引号标量。
 */
function yamlScalar(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return "''"
  if (/[:#{}[\],&*?|<>=!%@`'"]/.test(text) || /^[-?]/.test(text)) {
    return JSON.stringify(text)
  }
  return text
}

function buildPlanMarkdown(input: PlanFileInput): string {
  const title = input.title.trim() || '计划'
  const overview = input.overview.trim()

  const front: string[] = ['---', `name: ${yamlScalar(title)}`]
  if (overview) front.push(`overview: ${yamlScalar(overview)}`)
  front.push('isProject: false', '---', '')

  // 正文全量：已有 H1 就原样用，否则补一行标题；没有正文时退化成编号步骤
  const rawBody = input.body.trim()
  const numbered = input.steps.map(function (step, index) {
    return `${index + 1}. ${step}`
  })
  const body = rawBody
    ? /^#\s+/m.test(rawBody)
      ? rawBody
      : `# ${title}\n\n${rawBody}`
    : [`# ${title}`, '', ...numbered].join('\n')

  return `${front.join('\n')}\n${body}\n\n---\n> 由 cogito 计划模式生成（${new Date().toISOString()}）。\n`
}

/**
 * 写入工作区并返回相对路径。
 *
 * 文件名带时间戳：同一会话反复保存不会互相覆盖，也不会把上一版悄悄改掉。
 */
async function savePlanToWorkspace(rootPath: string, input: PlanFileInput): Promise<string> {
  const directory = await join(rootPath, PLAN_DIR)
  await mkdir(directory, { recursive: true })

  const title = input.title.trim() || '计划'
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, '-')
  const relative = `${PLAN_DIR}/${findPlanSlug(title)}-${stamp}.md`
  const absolute = await join(rootPath, relative)
  await writeTextFile(absolute, buildPlanMarkdown(input))
  return relative
}

export { buildPlanMarkdown, PLAN_DIR, savePlanToWorkspace }
export type { PlanFileInput }
