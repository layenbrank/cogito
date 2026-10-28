/**
 * 知识库磁贴的 dock 绑定：把「当前库 + 当前文档」变成一键动作。
 *
 * 全部动作都读**实时** store（打开文档/切库后立即生效），所以 scope 只需注册一次。
 */
import { useEffect } from 'react'

import { useDockStore, type DockScope } from '@/features/agent/dock'
import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useKnowledgeStore } from '@/stores/knowledge'

/** 知识库域的会话提示：只做内容，不碰别的域 */
const SYSTEM_TEXT = `你是 cogito 知识库里写作助手，与「知识库」磁贴共用同一个库目录。

约定：
- 需要读正文时用 app_knowledge_read_doc / app_knowledge_search，不要臆造内容；
- 要落文件时用 app_knowledge_write_doc：它只写待发布草稿（staging），不要声称已经发布；
- 用户确认后由界面发布，你只负责把内容写对、写清楚；
- 回答保持简洁；跨文档的问题先检索再答，并指出引用了哪些文档。`

/** 当前打开文档的正文（没有就返回空串） */
function findActiveContent(): string {
  return useKnowledgeStore.getState().markdown.trim()
}

function findActivePath(): string | null {
  return useKnowledgeStore.getState().activePath
}

function findBaseName(): string {
  const state = useKnowledgeBaseStore.getState()
  const base = state.bases.find(function (item) {
    return item.id === state.activeBaseID
  })
  return base?.name ?? '当前知识库'
}

/** 把正文按字符窗截断：整篇塞进一轮上下文没有意义 */
function slice(content: string, limit: number): string {
  return content.length > limit ? `${content.slice(0, limit)}\n（后文略）` : content
}

function useKnowledgeDockScope(): void {
  const toBind = useDockStore(function (state) {
    return state.toBind
  })
  const toUnbind = useDockStore(function (state) {
    return state.toUnbind
  })

  useEffect(
    function () {
      const scope: DockScope = {
        key: 'knowledge',
        title: '知识库助手',
        hint: '总结、续写、改写都在这；结果留在对话里，确认后才落到文档。',
        systemText: SYSTEM_TEXT,
        actions: [
          {
            id: 'summarize',
            label: '总结这篇',
            icon: 'lucide:list-tree',
            buildPrompt: function () {
              const path = findActivePath()
              const content = findActiveContent()
              if (!path || !content) return null
              return `请总结这篇文档的要点（3–6 条），并指出结构上最该改的一处。\n\n文档：${path}\n\n${slice(content, 6_000)}`
            }
          },
          {
            id: 'continue',
            label: '接着写',
            icon: 'lucide:pen-line',
            buildPrompt: function () {
              const path = findActivePath()
              const content = findActiveContent()
              if (!path || !content) return null
              // 续写只看文末一段：全文给模型只会让它重写整篇
              return `接在下面这段之后继续写（保持同样的语气与术语，不要重复已写内容，只输出新增部分）。\n\n文档：${path}\n\n${content.slice(-2_000)}`
            }
          },
          {
            id: 'outline',
            label: '改大纲',
            icon: 'lucide:heading',
            buildPrompt: function () {
              const path = findActivePath()
              const content = findActiveContent()
              if (!path || !content) return null
              return `按现有小标题整理这份文档的大纲（层级用列表表示），标出重复或该合并的小节。\n\n文档：${path}\n\n${slice(content, 4_000)}`
            }
          },
          {
            id: 'new-doc',
            label: '新建文档',
            icon: 'lucide:file-plus',
            buildPrompt: function () {
              return `在知识库「${findBaseName()}」里写一篇新文档。先用一句话问我主题与目标读者，我回答后再写。`
            }
          }
        ]
      }
      toBind(scope)
      return function () {
        toUnbind('knowledge')
      }
    },
    [toBind, toUnbind]
  )
}

export { useKnowledgeDockScope }
