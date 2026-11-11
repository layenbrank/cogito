/**
 * 检索块卡（对齐 assistant-ui `elements/retrieval-chunks`）
 *
 * 库内检索（`app_knowledge_search`）的命中是一**组段落**，不是一段正文：
 * 查询药丸 + 「N 段命中」+ 每条一张纸卡（标题 / 相对路径 / 片段 / 相关度条）。
 * 通用卡把 `{mode, channels, hits: [...]}` 整块摆出来，标题、路径、摘要、分数全糊在一起，
 * 而这里真正要读的只有「哪几段、哪段最相关、那段说了什么」。
 *
 * 三条口径：
 * - 分数是**相对本次检索**的（bm25 绝对值跨查询不可比），换算在 `parseRetrievalHits`；
 * - 短词回退（`mode: 'like'`）没有可信分数 → 元素只给「模糊」标记，不画分数条；
 * - 失败 / 取消不套这张卡（退回通用行看错误原文）。
 */
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { RetrievalChunks } from '@cogito/design/assistant/retrieval-chunks'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@cogito/design/components/collapsible'
import { clsx } from 'clsx'
import { useState } from 'react'

import { toAgentToolLabel } from '@/features/agent/tool-labels'
import { extractQuery, parseRetrievalHits } from '@/views/agent/chat/components/parse-tool-result'

type RetrievalCardProps = ToolCallMessagePartProps & { outputText: string }

function ToolCardRetrieval(props: RetrievalCardProps) {
  const isRunning = props.status?.type === 'running'
  const query = extractQuery(props.args) ?? toAgentToolLabel(props.toolName)
  const chunks = parseRetrievalHits(props.result)
  const raw = props.outputText.trim()
  const [isOpen, setOpen] = useState(false)

  return (
    <div
      data-slot="tool-card-retrieval"
      className="my-1 flex flex-col gap-1.5">
      <RetrievalChunks
        query={query}
        chunks={chunks}
        visibleCount={chunks.length}
        searching={isRunning}
      />
      {raw ? (
        <Collapsible
          open={isOpen}
          onOpenChange={setOpen}
          className="w-full">
          <CollapsibleTrigger
            data-slot="tool-card-retrieval-raw-trigger"
            className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 rounded-md px-1 py-0.5 text-xs transition-colors">
            <Icon
              icon="lucide:chevron-right"
              className={clsx('size-3 transition-transform duration-200', isOpen && 'rotate-90')}
            />
            原始结果
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="bg-muted/50 text-foreground/90 mt-1 max-h-48 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap">
              {raw}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}

export { ToolCardRetrieval }
export type { RetrievalCardProps }
