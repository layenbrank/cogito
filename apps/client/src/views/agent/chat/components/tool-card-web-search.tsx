/**
 * 联网搜索卡（对齐 assistant-ui `elements/web-search`）
 *
 * 一次检索 = 查询药丸 + 「读取 N 个来源」+ 逐条「域名首字母 + 标题 + 域名」。
 * 通用卡把检索结果整块 JSON / 整段文本摆出来，标题与站点糊在一起 —— 检索结果本质上
 * 是一张**列表**，就该按列表渲染：先认站（右侧等宽域名），再看标题。
 *
 * 三条口径：
 * - 查询词取 `args.query` 一类字段；取不到才退回工具名（`tool-labels` 的中文标题），
 *   药丸里永远有字，不会出现空药丸；
 * - 来源解析走 `parseWebSources`（结构化优先、文本兜底），这里只做展示映射；
 * - 原始结果默认折起来：有结构化行可读时，那坨 JSON 只在需要核对时展开。
 *
 * 失败 / 取消不套这张卡（`tool-card-body` 里就分发回通用行）：检索挂了要看的是错误原文，
 * 不是一张「没有找到来源」的空列表。
 */
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { WebSearch } from '@cogito/design/assistant/web-search'
import { toWebSearchResults } from '@cogito/design/assistant/web-search-state'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@cogito/design/components/collapsible'
import { clsx } from 'clsx'
import { useState } from 'react'

import { toAgentToolLabel } from '@/features/agent/tool-labels'
import { extractWebQuery, parseWebSources } from '@/views/agent/chat/components/parse-tool-result'

type WebSearchCardProps = ToolCallMessagePartProps & { outputText: string }

function ToolCardWebSearch(props: WebSearchCardProps) {
  const isRunning = props.status?.type === 'running'
  const query = extractWebQuery(props.args) ?? toAgentToolLabel(props.toolName)
  const rows = toWebSearchResults(
    parseWebSources(props.toolName, props.args, props.result, props.outputText)
  )
  const raw = props.outputText.trim()
  const [isOpen, setOpen] = useState(false)

  return (
    <div
      data-slot="tool-card-web-search"
      className="my-1 flex flex-col gap-1.5">
      <WebSearch
        query={query}
        results={rows}
        visibleResults={rows.length}
        searching={isRunning}
        cycle={0}
      />
      {raw ? (
        <Collapsible
          open={isOpen}
          onOpenChange={setOpen}
          className="w-full">
          <CollapsibleTrigger
            data-slot="tool-card-web-search-raw-trigger"
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

export { ToolCardWebSearch }
export type { WebSearchCardProps }
