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
import {
  ToolEmpty,
  ToolListCard,
  ToolPageHeader,
  ToolStatPill,
  ToolTag
} from '@/views/knowledge/surface/tool-surface.tsx'

const KIND_LABEL: Record<string, string> = {
  'broken-link': '断链',
  orphan: '孤儿页',
  'missing-index': '缺索引',
  'duplicate-title': '重复标题',
  'thin-page': '过短'
}

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
  const [hasRun, setHasRun] = useState(false)
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
      setHasRun(true)
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
    <div className="flex min-h-0 flex-1 flex-col">
      <ToolPageHeader
        title="Lint"
        description="检查断链、孤儿页；可选语义启发（重复标题 / 过短页）。"
        meta={
          hasRun ? (
            <>
              <ToolStatPill
                label="问题"
                value={issues.length}
                tone={issues.length > 0 ? 'warn' : 'ok'}
              />
              <ToolStatPill
                label="断链"
                value={brokenCount}
                tone={brokenCount > 0 ? 'danger' : 'default'}
              />
            </>
          ) : undefined
        }
        actions={
          <>
            <label className="text-muted-foreground mr-1 flex items-center gap-2 text-xs">
              <Switch
                checked={semanticEnabled}
                onCheckedChange={function (checked) {
                  setSemanticEnabled(checked)
                  writeLintConfig({ ...readLintConfig(), semanticEnabled: checked })
                }}
              />
              语义启发
            </label>
            <Button
              size="sm"
              variant="secondary"
              className="h-8"
              disabled={isRunning || brokenCount === 0}
              onClick={function () {
                void fixStubs()
              }}>
              建 stub（{brokenCount}）
            </Button>
            <Button
              size="sm"
              className="h-8"
              disabled={isRunning}
              onClick={function () {
                void runLint()
              }}>
              {isRunning ? '检查中…' : '运行 Lint'}
            </Button>
          </>
        }
      />
      {error ? <p className="text-destructive mb-2 text-xs">{error}</p> : null}
      <ScrollArea className="min-h-0 flex-1">
        {issues.length === 0 ? (
          <ToolEmpty
            icon="lucide:scan-text"
            title={isRunning ? '扫描中…' : hasRun ? '未发现问题' : '尚未运行'}
            description={
              hasRun
                ? '结构与语义检查通过。可在改动 wiki 后再跑一次。'
                : '点击「运行 Lint」扫描当前知识库页面。'
            }
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {issues.map(function (issue) {
              return (
                <li key={issue.id}>
                  <ToolListCard>
                    <div className="flex items-center gap-2">
                      <ToolTag>{KIND_LABEL[issue.kind] ?? issue.kind}</ToolTag>
                      <p className="text-muted-foreground truncate text-xs">{issue.page}</p>
                    </div>
                    <p className="mt-1.5 text-sm leading-6">{issue.detail}</p>
                  </ToolListCard>
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
