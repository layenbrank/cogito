/**
 * Page Links：当前文档出链/反链/断链 + 建缺失页。
 */
import { Button } from '@cogito/design/components/button'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useKnowledgeStore } from '@/stores/knowledge'
import {
  findPageLinks,
  insertMissingWikiPage,
  readWikiPagesFromDocs,
  type PageLinkBuckets
} from '@/views/knowledge/lib/page-links.ts'
import { openPath } from '@/views/knowledge/lib/session.ts'
import { joinPath } from '@/views/knowledge/lib/path.ts'

function PageLinks() {
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
  const activePath = useKnowledgeStore(function (state) {
    return state.activePath
  })
  const activeDoc = useKnowledgeStore(function (state) {
    return state.activeDoc
  })
  const [links, setLinks] = useState<PageLinkBuckets | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(
    function () {
      void refresh()
    },
    [activePath, activeDoc?.relPath, docs.length, activeBaseID, bases]
  )

  async function refresh() {
    const base = bases.find(function (item) {
      return item.id === activeBaseID
    })
    const rel =
      activeDoc?.relPath ||
      (activePath && base?.rootPath
        ? activePath.replace(/\\/g, '/').replace(base.rootPath.replace(/\\/g, '/') + '/', '')
        : null)
    if (!base?.rootPath || !rel) {
      setLinks(null)
      return
    }
    try {
      const pages = await readWikiPagesFromDocs({ rootPath: base.rootPath, docs })
      setLinks(findPageLinks(pages, rel))
    } catch (error) {
      console.error('[page-links] refresh failed', error)
    }
  }

  async function createMissing(title: string, withAcp: boolean) {
    const base = bases.find(function (item) {
      return item.id === activeBaseID
    })
    if (!base?.rootPath) return
    setBusy(true)
    try {
      const relative = await insertMissingWikiPage({
        rootPath: base.rootPath,
        title,
        draftWithAcp: withAcp
      })
      void rescan()
      await openPath(joinPath(base.rootPath, relative))
      toast.success(withAcp ? '已 ACP 起草并打开' : '已创建 stub')
      await refresh()
    } catch (error) {
      console.error('[page-links] create failed', error)
      toast.error(error instanceof Error ? error.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }

  if (!links) {
    return (
      <p className="text-muted-foreground px-2 py-2 text-xs">打开 wiki 页后显示链接</p>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[11px]"
          onClick={function () {
            void refresh()
          }}>
          刷新链接
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <section className="mb-2 px-1">
          <p className="text-muted-foreground mb-1 text-[11px] font-medium">
            出链 {links.outbound.length}
          </p>
          <ul className="text-xs">
            {links.outbound.map(function (title) {
              return <li key={`out-${title}`}>[[{title}]]</li>
            })}
          </ul>
        </section>
        <section className="mb-2 px-1">
          <p className="text-muted-foreground mb-1 text-[11px] font-medium">
            反链 {links.inbound.length}
          </p>
          <ul className="text-xs">
            {links.inbound.map(function (title) {
              return <li key={`in-${title}`}>[[{title}]]</li>
            })}
          </ul>
        </section>
        <section className="px-1">
          <p className="text-muted-foreground mb-1 text-[11px] font-medium">
            断链 {links.broken.length}
          </p>
          <ul className="flex flex-col gap-1">
            {links.broken.map(function (title) {
              return (
                <li
                  key={`brk-${title}`}
                  className="rounded border border-border px-1.5 py-1 text-xs">
                  <p>[[{title}]]</p>
                  <div className="mt-1 flex gap-1">
                    <Button
                      size="sm"
                      className="h-6 px-1.5 text-[11px]"
                      disabled={busy}
                      onClick={function () {
                        void createMissing(title, false)
                      }}>
                      建 stub
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[11px]"
                      disabled={busy}
                      onClick={function () {
                        void createMissing(title, true)
                      }}>
                      ACP 起草
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      </ScrollArea>
    </div>
  )
}

export { PageLinks }
