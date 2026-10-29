/**
 * 知识库磁贴的 dock 绑定：把「当前文档 + 选区」变成一键动作。
 *
 * 全部动作都读**实时**上下文（编辑器桥 + store），所以 scope 只需注册一次。
 */
import { useEffect } from 'react'
import { toast } from 'sonner'

import { useDockStore, type DockScope } from '@/features/agent/dock'
import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { findEditorContext, writeEditor } from '@/views/knowledge/workspace/editor-context.ts'

/** 知识库域的会话提示：只做内容，不碰别的域 */
const SYSTEM_TEXT = `你是 cogito 知识库里写作助手，与「知识库」磁贴共用同一个库目录。

约定：
- 需要读正文时用 app_knowledge_read_doc / app_knowledge_search，不要臆造内容；
- 要落文件时用 app_knowledge_write_doc：它只写待发布草稿（staging），不要声称已经发布；
- 用户确认后由界面发布，你只负责把内容写对、写清楚；
- 回答保持简洁；跨文档的问题先检索再答，并指出引用了哪些文档。`

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
        hint: '结果先留在对话里，点「应用到文档」才写入正文',
        systemText: SYSTEM_TEXT,
        toWrite: function (text) {
          if (!writeEditor(text)) {
            toast.error('先把要改的文档打开，再应用结果')
            return
          }
          toast.success('已写入编辑器（可 Ctrl+Z 撤销）')
        },
        actions: [
          {
            id: 'summarize',
            label: '总结这篇',
            icon: 'lucide:list-tree',
            buildPrompt: function () {
              const context = findEditorContext()
              if (!context.path || !context.content) return null
              return `请总结这篇文档的要点（3–6 条），并指出结构上最该改的一处。\n\n文档：${context.path}\n\n${slice(context.content, 6_000)}`
            }
          },
          {
            id: 'continue',
            label: '接着写',
            icon: 'lucide:pen-line',
            buildPrompt: function () {
              const context = findEditorContext()
              if (!context.path || !context.content) return null
              // 续写只看文末一段：全文给模型只会让它重写整篇
              return `接在下面这段之后继续写（保持同样的语气与术语，不要重复已写内容，只输出新增部分，不要解释）。\n\n文档：${context.path}\n\n${context.content.slice(-2_000)}`
            }
          },
          {
            id: 'rewrite',
            label: '改写选区',
            icon: 'lucide:wand-sparkles',
            buildPrompt: function () {
              const context = findEditorContext()
              const selected = context.selection.trim()
              if (!selected) return null
              return `把下面这段改写得更清楚、更简洁（保留原意与术语，只输出改写后的正文，不要解释）。\n\n${slice(selected, 4_000)}`
            }
          },
          {
            id: 'ask',
            label: '问这篇',
            icon: 'lucide:message-circle-question',
            buildPrompt: function () {
              const context = findEditorContext()
              if (!context.path || !context.content) return null
              return `基于下面这篇文档回答我的问题（如果文档里没有依据，直说没有，不要编）。\n\n文档：${context.path}\n\n${slice(context.content, 6_000)}\n\n问题：`
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
