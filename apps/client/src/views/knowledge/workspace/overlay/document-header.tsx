/**
 * 文档头：标题 + 元信息 + 右侧少量控件（模式 / 大纲抽屉 / 查找）。
 *
 * 编辑器优先之后这里只做「我现在写的是哪篇」：模式收进下拉，专注在标题栏菜单，
 * 不再让一排 32px 分段按钮霸占正文上方。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@cogito/design/components/tooltip'
import { cn } from 'cn'

import { useKnowledgeStore } from '@/stores/knowledge'
import { parseFrontMatter } from '@/views/knowledge/lib/front-matter.ts'
import type { KnowledgeViewMode } from '@/views/knowledge/lib/types.ts'
import { t } from '@/views/knowledge/locale.ts'
import { useSurfaceStore } from '@/views/knowledge/surface/store.ts'

const MODES: readonly { mode: KnowledgeViewMode; label: string }[] = [
  { mode: 'live', label: t('MODE_LIVE') },
  { mode: 'source', label: t('MODE_SOURCE') },
  { mode: 'split', label: t('MODE_SPLIT') }
]

/**
 * 标题优先级：frontmatter `title` > 正文一级标题 > 文件名。
 * wiki 页的标题写在 frontmatter 里（正文从 ## 起），不读它就会把 slug 当标题。
 */
function findDocTitle(markdown: string, path: string | null): string {
  const frontTitle = parseFrontMatter(markdown)
    .frontMatter?.match(/^title:\s*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '')
  if (frontTitle) return frontTitle

  const heading = markdown
    .split('\n')
    .find(function (line) {
      return line.startsWith('# ')
    })
    ?.replace(/^#\s+/, '')
    .trim()
  if (heading) return heading
  const name = path?.split(/[\\/]/).pop() ?? ''
  return name.replace(/\.md$/i, '') || '未命名文档'
}

function findRelPath(path: string | null, rootDir: string | null): string {
  if (!path) return ''
  if (rootDir && path.toLowerCase().startsWith(rootDir.toLowerCase())) {
    return path
      .slice(rootDir.length)
      .replace(/^[\\/]/, '')
      .replace(/\\/g, '/')
  }
  return path.split(/[\\/]/).slice(-2).join('/')
}

function ModeButton(props: {
  mode: KnowledgeViewMode
  current: KnowledgeViewMode
  label: string
  onPick: (mode: KnowledgeViewMode) => void
}) {
  return (
    <DropdownMenuItem
      className="gap-2"
      onClick={function () {
        props.onPick(props.mode)
      }}>
      <Icon
        icon="lucide:check"
        className={cn('size-4', props.current === props.mode ? 'text-primary' : 'opacity-0')}
      />
      {props.label}
    </DropdownMenuItem>
  )
}

function DocumentHeader(props: { onToggleFind: () => void }) {
  const markdown = useKnowledgeStore(function (state) {
    return state.markdown
  })
  const activePath = useKnowledgeStore(function (state) {
    return state.activePath
  })
  const rootDir = useKnowledgeStore(function (state) {
    return state.rootDir
  })
  const stats = useKnowledgeStore(function (state) {
    return state.stats
  })
  const isDirty = useKnowledgeStore(function (state) {
    return state.isDirty
  })
  const viewMode = useKnowledgeStore(function (state) {
    return state.viewMode
  })
  const toSetViewMode = useKnowledgeStore(function (state) {
    return state.toSetViewMode
  })
  const isAsideOpen = useKnowledgeStore(function (state) {
    return state.isOutlineOpen
  })
  const asideTab = useSurfaceStore(function (state) {
    return state.asideTab
  })
  const toToggleAside = useSurfaceStore(function (state) {
    return state.toToggleAside
  })

  const title = findDocTitle(markdown, activePath)
  const relPath = findRelPath(activePath, rootDir)
  const isOutlineOpen = isAsideOpen && asideTab === 'outline'
  const currentMode = MODES.find(function (item) {
    return item.mode === viewMode
  })

  return (
    <TooltipProvider delay={200}>
      <header className="border-border/60 bg-background/80 flex shrink-0 items-center gap-4 border-b px-6 py-2.5 backdrop-blur-md">
        <div className="min-w-0 flex-1">
          <h1 className="text-foreground truncate text-[20px] leading-7 font-semibold tracking-tight">
            {title}
          </h1>
          <p className="text-muted-foreground truncate text-[11px]">
            {relPath}
            {relPath ? ' · ' : ''}
            {stats.chars} 字符
            {' · '}
            {isDirty ? '未保存' : '已保存'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground h-8 gap-1 px-2.5 text-[12px] font-medium"
                  title="视图模式"
                />
              }>
              {currentMode?.label ?? t('MODE_LIVE')}
              <Icon
                icon="lucide:chevron-down"
                className="size-3.5 opacity-60"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-36">
              <DropdownMenuGroup>
                <DropdownMenuLabel>视图模式</DropdownMenuLabel>
                {MODES.map(function (item) {
                  return (
                    <ModeButton
                      key={item.mode}
                      mode={item.mode}
                      current={viewMode}
                      label={item.label}
                      onPick={toSetViewMode}
                    />
                  )
                })}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant={isOutlineOpen ? 'secondary' : 'ghost'}
                  size="icon"
                  className="size-8 rounded-lg"
                  aria-label="大纲与链接"
                  aria-pressed={isOutlineOpen}
                  onClick={function () {
                    toToggleAside('outline')
                  }}
                />
              }>
              <Icon
                icon="lucide:panel-right"
                className="size-4"
              />
            </TooltipTrigger>
            <TooltipContent>大纲 / 链接</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-lg"
                  aria-label={t('FIND')}
                  onClick={props.onToggleFind}
                />
              }>
              <Icon
                icon="lucide:text-search"
                className="size-4"
              />
            </TooltipTrigger>
            <TooltipContent>{t('FIND')}</TooltipContent>
          </Tooltip>
        </div>
      </header>
    </TooltipProvider>
  )
}

export { DocumentHeader }
