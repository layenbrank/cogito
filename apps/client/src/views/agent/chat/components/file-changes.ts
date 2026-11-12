/**
 * 从工具调用里读出「文件改动」的公共映射。
 *
 * 两个元素都要这份数据：tool-timeline 的尾部统计芯片（`composer.tsx +14 −3`）与
 * file-tree 的改动文件树（`packages/core/src` 底下挂 `+24 −6`）。差异只在形状 ——
 * 一个要基名、一个要整条路径 —— 所以这里只负责「读出来」，怎么摆由各自的适配层决定。
 *
 * 认三种真实形态：整段写入（`content`）、整文件 before + after、定点替换的
 * `edits: [{ oldText, newText }]`（多段按段合计，见 `parseWriteChurn`）。
 */
import type { ToolCallMessagePart } from '@assistant-ui/react'

import { parseWriteChurn } from '@/views/agent/chat/components/parse-tool-result'

interface FileChurn {
  /** 工具参数里的原始路径（可能是绝对路径 / 相对路径，交给消费方归一） */
  readonly path: string
  readonly additions: number
  readonly deletions: number
}

/** 一次写入的增删；没有路径、或压根没改动，都返回 null */
function readWriteChurn(part: ToolCallMessagePart): FileChurn | null {
  return parseWriteChurn(part.args)
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
