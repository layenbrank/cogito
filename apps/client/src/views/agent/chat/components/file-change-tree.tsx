/**
 * File tree 的 app 适配层：把一条助手消息里的写入摊成「改动文件树」。
 *
 * 元素页的口径是宿主负责「扁平列表 → 树」：这里用 `collectFileChanges`（工具参数里的
 * before/after 现算增删，只认整文件写入）拿到 `{ path, additions, deletions }`，
 * 再交给 `buildChangeNodes` 分组（目录一层 + 顶格文件，同一文件写两次合成一行）。
 *
 * 挂载位置：`ThreadComponents.RunSummary`（design 侧「回合小结」槽），排在最终回答之后，
 * 只在回合结束（`complete` / `cancelled` / `error` / 截断）时渲染 —— 流式中途挂上去会跟着
 * 每次写入闪变，等审批时也不算结束。没有写文件就返回 null，那一轮什么都不渲染。
 *
 * 与过程区不冲突：过程是一块一块各自折叠的（思考一段一条、工具一件一行），
 * 这张卡摊的是**结果**（一共改了哪些文件），不进任何折叠，也不会多出第二条折叠条。
 */
import { FileChangeTree } from '@cogito/design/assistant/file-change-tree'
import { buildChangeNodes } from '@cogito/design/assistant/file-change-tree-state'
import { useMemo } from 'react'

import { collectFileChanges } from '@/views/agent/chat/components/file-changes'

interface AgentFileChangeTreeProps {
  /** 这条消息里的 part（只取其中的写入工具） */
  parts: readonly { readonly type: string }[]
  /** 露出前几行（渐进揭示用）；不传全出 */
  visibleCount?: number
  className?: string
}

function AgentFileChangeTree({ parts, visibleCount, className }: AgentFileChangeTreeProps) {
  const nodes = useMemo(
    function () {
      return buildChangeNodes(collectFileChanges(parts))
    },
    [parts]
  )

  if (nodes.length === 0) return null

  return <FileChangeTree className={className} nodes={nodes} visibleCount={visibleCount} />
}

export { AgentFileChangeTree }
