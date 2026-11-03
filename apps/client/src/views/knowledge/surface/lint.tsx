/**
 * Lint 页：结构检查 + 可选语义启发 + 一键 stub 修复。
 */
import { Button } from '@cogito/design/components/button'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import { Switch } from '@cogito/design/components/switch'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { useState } from 'react'
import { toast } from 'sonner'

import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import {
  filterLintIssues,
  fixBrokenLinkStubs,
  readLintConfig,
  writeLintConfig
} from '@/views/knowledge/lib/lint-fixes.ts'
import { joinPath } from '@/views/knowledge/lib/path.ts'
import {
  lintWikiPages,
  lintWikiSemantic,
  type LintIssue,
  type WikiPage
} from '@/views/knowledge/lib/wiki-lint.ts'

function LintTab() {
  const docs = useKnowledgeBaseStore(function (state) {
    return state.docs
  })
  const bases = useKnowledgeBaseStore(function (state) {
    return state.bases
  })
  const activeBaseID = useKnowledgeBaseStore(function (state) {
    return state.activeBaseID
  })
  const rescan = useKnowledgeBaseStore(function (state) {
    return state.rescan
  })
  const [issues, setIssues] = useState<LintIssue[]>([])
  const [isRunning, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [semanticEnabled, setSemanticEnabled] = useState(function () {
    return readLintConfig().semanticEnabled
  })

  async function runLint() {
    const base = bases.find(function (item) {
      return item.id === activeBaseID
    })
    if (!base?.rootPath) {
      setError('无活动知识库')
      return
    }
    setRunning(true)
    setError(null)
    try {
      const pages: WikiPage[] = []
      for (const doc of docs) {
        if (!/\.md$/i.test(doc.relPath)) continue
        try {
          const content = await readTextFile(joinPath(base.rootPath, doc.relPath))
          pages.push({
            relative: doc.relPath,
            title: doc.title,
            content
          })
        } catch (readError) {
          console.warn('[lint] skip unreadable', doc.relPath, readError)
        }
      }
      const structural = lintWikiPages(pages)
      const semantic = semanticEnabled ? lintWikiSemantic(pages) : []
      setIssues(filterLintIssues([...structural, ...semantic], readLintConfig()))
    } catch (lintError) {
      const message = lintError instanceof Error ? lintError.message : String(lintError)
      console.error('[lint] run failed', lintError)
      setError(message)
    } finally {
      setRunning(false)
    }
  }

  async function fixStubs() {
    const base = bases.find(function (item) {
      return item.id === activeBaseID
    })
    if (!base?.rootPath) {
      toast.error('无活动知识库')
      return
    }
    try {
      const created = await fixBrokenLinkStubs({
        rootPath: base.rootPath,
        issues
      })
      toast.success(`已创建 ${created} 个 stub 页`)
      void rescan()
      await runLint()
    } catch (fixError) {
      console.error('[lint] fix failed', fixError)
      toast.error(fixError instanceof Error ? fixError.message : '修复失败')
    }
  }

  const brokenCount = issues.filter(function (issue) {
    return issue.kind === 'broken-link'
  }).length

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={isRunning}
          onClick={function () {
            void runLint()
          }}>
          {isRunning ? '检查中…' : '运行 Lint'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={isRunning || brokenCount === 0}
          onClick={function () {
            void fixStubs()
          }}>
          一键建 stub（{brokenCount}）
        </Button>
        <label className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <Switch
            checked={semanticEnabled}
            onCheckedChange={function (checked) {
              setSemanticEnabled(checked)
              writeLintConfig({ ...readLintConfig(), semanticEnabled: checked })
            }}
          />
          语义启发（重复标题 / 过短）
        </label>
        <span className="text-muted-foreground text-[11px]">{issues.length} 条</span>
      </div>
      {error ? <p className="text-destructive px-1 text-xs">{error}</p> : null}
      <ScrollArea className="min-h-0 flex-1">
        {issues.length === 0 ? (
          <p className="text-muted-foreground px-1 py-2 text-xs">
            {isRunning ? '扫描中…' : '暂无问题（或尚未运行）'}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {issues.map(function (issue) {
              return (
                <li
                  key={issue.id}
                  className="rounded-md border border-border px-2 py-1.5 text-xs">
                  <p className="font-medium">{issue.kind}</p>
                  <p className="text-muted-foreground">{issue.page}</p>
                  <p>{issue.detail}</p>
                </li>
              )
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}

export { LintTab }
