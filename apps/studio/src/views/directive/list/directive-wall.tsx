import { Button } from '@cogito/design/components/button'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import { Separator } from '@cogito/design/components/separator'
import { Icon } from '@iconify/react/offline'
import { memo } from 'react'

import { useCorexStore } from '@/stores/corex'

import { estimateGroupHeight } from '@/views/directive/render/card-size'
import { CardSkeleton } from '@/views/directive/render/card-skeleton'
import { StreamedGrid } from '@/views/directive/render/streamed-grid'
import { ViewportGate } from '@/views/directive/render/viewport-gate'
import { EMPTY_RUNS } from '@/views/directive/run/run-status'
import { DirectiveImport, DirectiveMarkAllRead, DirectiveSearch, DirectiveSort } from './controls'
import DirectiveCard from './directive-card'
import { DirectiveGroupSection } from './group-section'
import { DirectivePlaceholder } from './placeholder'
import { makePlaceholderActions } from './placeholder-actions'
import { useDirectiveList } from './use-directive-list'
import { useGroupCollapse } from './use-group-collapse'
import { useWallCols } from './use-wall-cols'

/**
 * 卡片墙：指令页的正脸。所有指令按分类（或最近执行）分组铺成网格，
 * 每张卡片自己带着运行状态，点进去才去编排台。
 *
 * 性能策略（元素多时）：
 * 1. 切排序就地调和，不做整墙 `key` 重挂
 * 2. 分组开合瞬时切换（不做高度动画）
 * 3. 组内可见区门闩 + 分片流式
 * 4. 单卡 `content-visibility: auto`（见 StreamedGrid）
 */

/** 超过这么多才启用可见区门闩；小组直接流式即可 */
const VIEWPORT_GATE_MIN = 8
const WALL_CHUNK = 12
/** lg 起三列：~1100 宽窗口不再两列撑满；与 findWallCols 同步 */
const WALL_GRID = 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'

interface Props {
  /** 与运行台共用同一份步骤数，别各自算一遍 */
  stepCounts: Record<string, number>
  onOpen: (name: string) => void
  onRun: (name: string) => void
}

function DirectiveWall(props: Props) {
  const list = useDirectiveList()
  const { groups, now, shown, summaries } = list
  const collapse = useGroupCollapse(groups, list.sortMode)
  const wallCols = useWallCols()
  const streamEpoch = `${list.sortMode}:${list.query}`

  const placeholder = makePlaceholderActions(list.state, {
    onNew: function () {
      props.onOpen(list.findNewName())
    },
    onImportFolder: function () {
      void list.importFrom('dir')
    },
    onImportFile: function () {
      void list.importFrom('file')
    },
    onClearQuery: function () {
      list.updateQuery('')
    },
    onRetry: list.retry,
    onRefresh: function () {
      void useCorexStore.getState().refreshDirectives()
    }
  })

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/35">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 bg-background/80 px-5 py-3 backdrop-blur-md">
        <DirectiveSearch
          value={list.query}
          className="min-w-56 max-w-md flex-1"
          onChange={list.updateQuery}
        />
        <DirectiveSort
          value={list.sortMode}
          className="shrink-0"
          onChange={list.handleSort}
        />

        <span className="ml-auto flex shrink-0 items-center gap-1">
          <DirectiveMarkAllRead names={list.unread} />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="cursor-pointer text-muted-foreground"
            aria-label="重新读取指令目录"
            title="重新读取指令目录"
            onClick={function () {
              void useCorexStore.getState().refreshDirectives()
            }}>
            <Icon icon="mdi:refresh" />
          </Button>
          <DirectiveImport
            onImportFolder={function () {
              void list.importFrom('dir')
            }}
            onImportFile={function () {
              void list.importFrom('file')
            }}
          />
          <Separator
            orientation="vertical"
            className="mx-0.5 h-5"
          />
          <Button
            type="button"
            size="sm"
            className="cursor-pointer rounded-full px-3.5 shadow-xs"
            onClick={function () {
              props.onOpen(list.findNewName())
            }}>
            <Icon icon="mdi:plus" />
            新增指令
          </Button>
        </span>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-7 px-5 pb-6">
          {shown === 0 ? (
            <DirectivePlaceholder
              state={list.state}
              detail={list.loadError}
              actions={placeholder}
            />
          ) : (
            groups.map(function (group) {
              const isOpen = collapse.isOpen(group.key)
              const estimateHeight = estimateGroupHeight(
                'wall',
                group.items.length,
                wallCols
              )

              return (
                <DirectiveGroupSection
                  key={group.key}
                  group={group}
                  variant="wall"
                  isOpen={isOpen}
                  onOpenChange={function (open) {
                    collapse.updateOpen(group.key, open)
                  }}>
                  <ViewportGate
                    enabled={group.items.length >= VIEWPORT_GATE_MIN}
                    estimateHeight={estimateHeight}
                    placeholder={
                      <div className={WALL_GRID}>
                        {Array.from(
                          { length: Math.min(WALL_CHUNK, group.items.length) },
                          function (_, index) {
                            return (
                              <CardSkeleton
                                key={`${group.key}-bone-${index}`}
                                variant="wall"
                              />
                            )
                          }
                        )}
                      </div>
                    }>
                    <StreamedGrid
                      items={group.items}
                      resetKey={`${streamEpoch}:${group.key}`}
                      chunkSize={WALL_CHUNK}
                      gridClassName={WALL_GRID}
                      skeletonVariant="wall"
                      findKey={function (entry) {
                        return entry.name
                      }}
                      renderItem={function (entry) {
                        return (
                          <DirectiveCard
                            variant="wall"
                            entry={entry}
                            isActive={false}
                            runs={summaries[entry.name] ?? EMPTY_RUNS}
                            stepCount={props.stepCounts[entry.name] ?? 0}
                            now={now}
                            onOpen={props.onOpen}
                            onRun={props.onRun}
                            onDelete={list.requestDelete}
                          />
                        )
                      }}
                    />
                  </ViewportGate>
                </DirectiveGroupSection>
              )
            })
          )}
        </div>
      </ScrollArea>
      {list.importDialog}
      {list.deleteDialog}
    </div>
  )
}

/** 运行台开合只改 dock 状态；墙面 props 不变时跳过调和 */
export default memo(DirectiveWall)
