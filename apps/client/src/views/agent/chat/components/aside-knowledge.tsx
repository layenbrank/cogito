/**
 * 右栏「知识库」页签：与 composer 左下角的「知识库」按钮共用一份浏览器。
 *
 * 区别只在入口：这里适合先翻一圈再决定引用什么；composer 那边适合边写边挂。
 */
import type { useAui } from '@assistant-ui/react'

import { KnowledgeBrowser } from './knowledge-browser.tsx'

interface AsideKnowledgeProps {
  aui: ReturnType<typeof useAui>
}

function AsideKnowledge(props: AsideKnowledgeProps) {
  return (
    <KnowledgeBrowser
      aui={props.aui}
      active
    />
  )
}

export { AsideKnowledge }
