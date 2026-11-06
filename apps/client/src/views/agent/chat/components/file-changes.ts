/**
 * 从工具调用里读出「文件改动」的公共映射。
 *
 * 两个元素都要这份数据：tool-timeline 的尾部统计芯片（`composer.tsx +14 −3`）与
 * file-tree 的改动文件树（`packages/core/src` 底下挂 `+24 −6`）。差异只在形状 ——
 * 一个要基名、一个要整条路径 —— 所以这里只负责「读出来」，怎么摆由各自的适配层决定。
 *
 * 只看**整文件写入**（工具参数里同时有 before / after）：片段级改动（`old_string` /
 * `new_string`）算不出真实增删，宁可不出统计，也不给一个假数。
 */
import type { ToolCallMessagePart } from '@assistant-ui/react'

import { buildLineDiff, findWritePath, parseWriteTexts } from '@/views/agent/chat/components/parse-tool-result'

interface FileChurn {
  /** 工具参数里的原始路径（可能是绝对路径 / 相对路径，交给消费方归一） */
  readonly path: string
  readonly additions: number
  readonly deletions: number
}

/** 一次写入的增删；不是整文件写入、没有路径、或压根没改动，都返回 null */
function readWriteChurn(part: ToolCallMessagePart): FileChurn | null {
  const { before, after } = parseWriteTexts(part.args)
  if (before === null || after === null) return null
  const diff = buildLineDiff(before, after)
  if (diff.additions === 0 && diff.deletions === 0) return null
  const path = findWritePath(part.args)
  if (!path) return null
  return { path, additions: diff.additions, deletions: diff.deletions }
}

/** 一条消息里所有写入的增删，按工具调用顺序（同一文件写两次就是两条，合并交给下游） */
function collectFileChanges(parts: readonly { readonly type: string }[]): FileChurn[] {
  const changes: FileChurn[] = []
  for (const part of parts) {
    if (part.type !== 'tool-call') continue
    const churn = readWriteChurn(part as ToolCallMessagePart)
    if (churn) changes.push(churn)
  }
  return changes
}

export { collectFileChanges, readWriteChurn }
export type { FileChurn }
