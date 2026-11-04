/**
 * 计划落盘：手动保存到工作区 `.cogito/plans/`，以及把已保存的计划读回来执行。
 *
 * 格式对齐 Cursor 的 `.cursor/plans/*.plan.md`：frontmatter 只放**总结**
 * （`name` / `overview`），其余全部是**完整计划正文**。
 * 不写 `todos:` 清单：清单是正文的摘要，一旦落盘就会被当成「任务全集」读取，
 * 导致执行时漏掉正文里的文件级细节与验证步骤（见 plan-mode.md）。
 *
 * 计划默认**不**落盘，由用户点「保存」才写文件 —— 之后它可以当持久记忆、
 * PR 描述或团队共享的实现依据。写了就必须能读回来：`listPlanFiles` / `readPlanFile`
 * 让右栏「从文件载入」可以列出多份计划并一键执行。
 */
import { join } from '@tauri-apps/api/path'
import { mkdir, readDir, readTextFile, stat, writeTextFile } from '@tauri-apps/plugin-fs'

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

interface PlanFileEntry {
  /** 文件名（含 `.md`） */
  name: string
  /** 工作区相对路径，形如 `.cogito/plans/foo-2026-01-01.md` */
  relative: string
  /** 毫秒时间戳；文件系统不给 mtime 时退化为 0 */
  modifiedAt: number
}

interface PlanFileContent {
  title: string
  overview: string
  body: string
  /** 工作区相对路径 */
  filePath: string
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

/** 去掉 `buildPlanMarkdown` 追加的生成说明，让「存 → 读」正文逐字一致 */
function stripGeneratedFooter(text: string): string {
  return text.replace(/\n*---\n>\s*由 cogito 计划模式生成[^\n]*\n?$/, '').replace(/\s+$/, '')
}

function unquote(value: string): string {
  const text = value.trim()
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return String(JSON.parse(text))
    } catch (error) {
      console.warn('[agent/plan-file] YAML 双引号标量解析失败，按原文使用:', error)
      return text.slice(1, -1)
    }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1)
  return text
}

/**
 * 解析计划文件（纯函数，便于单测）：frontmatter 只认 `name` / `overview`，
 * 其余原样当正文。`name` 缺失时回退到文件名（去扩展名）。
 */
function parsePlanFile(text: string, fileName: string): Omit<PlanFileContent, 'filePath'> {
  const normalized = text.replace(/\r\n/g, '\n')
  const frontmatter = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  let title = ''
  let overview = ''
  let body = normalized
  if (frontmatter) {
    body = normalized.slice(frontmatter[0].length)
    for (const line of frontmatter[1].split('\n')) {
      const matched = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim())
      if (!matched) continue
      if (matched[1] === 'name') title = unquote(matched[2])
      if (matched[1] === 'overview') overview = unquote(matched[2])
    }
  }
  const fallback = fileName.replace(/\.md$/i, '')
  return {
    title: title || fallback,
    overview,
    body: stripGeneratedFooter(body.trim())
  }
}

/**
 * 列出工作区里的计划文件，按 mtime 倒序（最新的在最上面）。
 * 目录不存在时返回空数组 —— 「还没保存过」不是错误。
 */
async function listPlanFiles(rootPath: string): Promise<PlanFileEntry[]> {
  const directory = await join(rootPath, PLAN_DIR)
  let entries
  try {
    entries = await readDir(directory)
  } catch (error) {
    console.warn('[agent/plan-file] 读取计划目录失败（可能还没保存过）:', error)
    return []
  }
  const files = entries.filter(function (entry) {
    return entry.isFile && /\.md$/i.test(entry.name)
  })
  const rows = await Promise.all(
    files.map(async function (entry): Promise<PlanFileEntry> {
      const relative = `${PLAN_DIR}/${entry.name}`
      let modifiedAt = 0
      try {
        const info = await stat(await join(rootPath, relative))
        modifiedAt = info.mtime ? new Date(info.mtime).getTime() : 0
      } catch (error) {
        console.warn('[agent/plan-file] 读取计划文件 mtime 失败:', relative, error)
      }
      return { name: entry.name, relative, modifiedAt }
    })
  )
  return rows.sort(function (left, right) {
    return right.modifiedAt - left.modifiedAt || left.name.localeCompare(right.name)
  })
}

/** 读回一份已保存的计划 */
async function readPlanFile(rootPath: string, relative: string): Promise<PlanFileContent> {
  const absolute = await join(rootPath, relative)
  const text = await readTextFile(absolute)
  const name = relative.split('/').pop() ?? relative
  return { ...parsePlanFile(text, name), filePath: relative }
}

export {
  buildPlanMarkdown,
  listPlanFiles,
  parsePlanFile,
  PLAN_DIR,
  readPlanFile,
  savePlanToWorkspace
}
export type { PlanFileContent, PlanFileEntry, PlanFileInput }
