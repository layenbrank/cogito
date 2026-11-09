/**
 * 会话 cwd 的选择：**只做两件事 —— 挑哪个目录、这个目录还在不在**。
 *
 * 为什么值得单独一层：cwd 是 `session/new` 的必填参数，goose 对「目录不存在」只会回
 * 一句 JSON-RPC `-32602 Invalid params`，界面上完全看不出是哪条配置坏了。
 * 这个模块把「路径没了」变成一句用户能照做的中文提示，并且**不再把这种失败当崩溃上报**
 * （见 `ExpectedError`）。
 *
 * 顺序即优先级：工作区里的文件夹按列表顺序排，第一个真实存在的就是 cwd，
 * 与 `findRootPath` 同口径（不再区分主文件夹）。
 */

import { ExpectedError } from '@/utils/expected-error'

/** 探测结果：`null` = 判断不了（非 Tauri、权限不足、网络盘超时），不能据此拦人 */
type PathProbe = (path: string) => Promise<boolean | null>

interface FolderLike {
  path?: string | null
}

class WorkspaceCwdError extends ExpectedError {
  /** 这次涉及的（全部不存在的）候选路径 */
  readonly paths: string[]

  constructor(paths: string[]) {
    super(
      `工作区文件夹不存在：${paths.join('、')}。` +
        '请到「设置 → 工作区」把该文件夹改回正确位置或移除，然后重发这条消息。'
    )
    this.name = 'WorkspaceCwdError'
    this.paths = paths
  }
}

function collectPaths(folders: readonly FolderLike[]): string[] {
  const seen = new Set<string>()
  const paths: string[] = []
  for (const folder of folders) {
    const path = (folder.path ?? '').trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }
  return paths
}

/**
 * 选出会话要用的 cwd。
 *
 * - 有存在目录 → 用第一个存在的（后面那些可能是已失效的历史记录，不该挡人）；
 * - 全部不存在 → 抛 `WorkspaceCwdError`，带上是哪几条路径；
 * - 一个都判断不了 → 沿用第一个（宁可让 goose 自己报错，也不因探测失败阻断发送）；
 * - 没配置任何文件夹 → `fallback()`（用户家目录）。
 */
async function pickWorkspaceCwd(
  folders: readonly FolderLike[],
  probe: PathProbe,
  fallback: () => Promise<string>
): Promise<string> {
  const paths = collectPaths(folders)
  if (paths.length === 0) return fallback()

  let firstUnknown: string | null = null
  for (const path of paths) {
    const exists = await probe(path)
    if (exists === true) return path
    if (exists === null && firstUnknown === null) firstUnknown = path
  }

  if (firstUnknown) return firstUnknown
  throw new WorkspaceCwdError(paths)
}

export { WorkspaceCwdError, pickWorkspaceCwd }
export type { FolderLike, PathProbe }
