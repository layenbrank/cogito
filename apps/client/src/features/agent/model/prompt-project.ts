/**
 * 项目约定（`AGENTS.md`）→ 系统提示的「项目约定」段（S7）。
 *
 * 三条硬规矩：
 * 1. **只认 cwd 那一份**：不往上找父目录、不合并多份。多个来源的约定叠在一起时，
 *    优先级就说不清了 —— 而这段是外来输入，必须能被一句话说清「它从哪来」；
 * 2. **≤ 8KB**：超了按 utf-8 字节截断并在段里标注原文大小，模型与用户都能看见
 *    「这里被砍过」；
 * 3. **是数据不是指令**：正文包在围栏里、围栏标记转义（见 `prompts.ts::sanitizeFence`），
 *    并且安全规则段永远排在它前面。
 *
 * 读文件走 `WorkspaceFiles.readFile`（`workspaceFiles:readFile`，Rust 侧做根目录
 * containment 校验），**不引 plugin-fs** —— 门禁里 plugin-fs 的引用面只许缩小。
 */
import { WorkspaceFiles } from '@/lib/workspace-files'
import { useAgentStore } from '@/stores/agent'

import {
  PROJECT_MAX_BYTES,
  findSystemPrompt,
  normalizeProjectText,
  truncateToBytes
} from './prompts'
import type { ProjectConvention, PromptContext } from './prompts'
import type { ScenarioKey } from './scenarios'

/** 只认这个文件名（cwd 下），不识别 `AGENTS.local.md` 之类的变体 */
const AGENTS_FILE = 'AGENTS.md'

interface ReadFileResult {
  path: string
  content: string
}

/** 读文件的形状：单测传假实现，不必起 Tauri */
type ReadFile = (roots: string[], path: string) => Promise<ReadFileResult>

/** 拼 cwd 下的文件路径（保留 cwd 原本的分隔符风格） */
function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return `${dir.replace(/[\\/]+$/, '')}${sep}${name}`
}

/**
 * 当前 agent 该读哪个目录的约定：活跃会话的工作区 → 该工作区第一个目录。
 *
 * 与 `app_workspace_list` / 代码窗的「根」同一口径：一个工作区可能有多个目录，
 * 约定只认第一个（`sort` 最小），避免同一会话里两套规则打架。
 *
 * @param workspaceID 后台续跑等场景可显式指定工作区；不传就用当前活跃会话 / 工作区
 */
function findAgentCwd(workspaceID?: string | null): string | null {
  const state = useAgentStore.getState()
  const activeSession = state.sessions.find(function (session) {
    return session.id === state.activeSessionID
  })
  const target = workspaceID ?? activeSession?.workspaceID ?? state.activeWorkspaceID
  if (!target) return null
  const folders = state.workspaceFolders
    .filter(function (folder) {
      return folder.workspaceID === target
    })
    .sort(function (left, right) {
      return left.sort - right.sort
    })
  return folders[0]?.path ?? null
}

/** 原文 → 段输入（纯函数：超限截断 + 空白归一；空文件当没有） */
function buildProjectConvention(path: string, raw: string): ProjectConvention | null {
  const normalized = normalizeProjectText(raw)
  if (!normalized) return null
  const rawBytes = new TextEncoder().encode(normalized).length
  const { text, truncated } = truncateToBytes(normalized, PROJECT_MAX_BYTES)
  return { path, content: text, rawBytes, truncated }
}

/**
 * 读 cwd 下的 `AGENTS.md`。
 *
 * 失败一律返回 `null`：文件不存在、cwd 不在授权范围、读盘报错 —— 都只是「没有项目
 * 约定」，不该让整轮对话起不来。
 */
async function loadProjectConvention(
  cwd: string | null | undefined,
  read: ReadFile = WorkspaceFiles.readFile
): Promise<ProjectConvention | null> {
  if (!cwd) return null
  const path = joinPath(cwd, AGENTS_FILE)
  try {
    const result = await read([cwd], path)
    return buildProjectConvention(result.path || path, result.content)
  } catch (error) {
    // 缺 AGENTS.md 是常态（大多数仓库没有），所以只记 debug 级别、不打扰用户；
    // 真出错（权限 / 不在授权范围）时也能在控制台查到这一行
    console.debug('[agent/prompt] 未读到 AGENTS.md，按「无项目约定」继续', error)
    return null
  }
}

interface BuildSystemPromptOptions {
  /** 显式指定 cwd（后台续跑等场景）；不传就读当前活跃会话的工作区 */
  cwd?: string | null
  /** 已经读过 / 构造好的约定（测试与重试复用） */
  project?: ProjectConvention | null
}

/**
 * 装配一整段系统提示（安全规则 + 五段）。
 *
 * 这是**唯一**的入口：`port/model.ts` 与 `goal-continue.ts` 都从这里取，避免两条
 * 路径拼出两套提示词。
 */
async function buildSystemPrompt(
  scenario: ScenarioKey,
  context?: PromptContext,
  options?: BuildSystemPromptOptions
): Promise<string> {
  const project =
    options?.project !== undefined
      ? options.project
      : await loadProjectConvention(options?.cwd ?? findAgentCwd())
  return findSystemPrompt(scenario, context, project)
}

export {
  AGENTS_FILE,
  buildProjectConvention,
  buildSystemPrompt,
  findAgentCwd,
  joinPath,
  loadProjectConvention
}
export type { BuildSystemPromptOptions, ReadFile, ReadFileResult }
