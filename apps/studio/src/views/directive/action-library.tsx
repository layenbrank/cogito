import { Badge } from '@i-thinking/design/components/badge'
import { Card, CardContent } from '@i-thinking/design/components/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@i-thinking/design/components/dialog'
import { Input } from '@i-thinking/design/components/input'
import { ToggleGroup, ToggleGroupItem } from '@i-thinking/design/components/toggle-group'
import { Icon } from '@iconify/react/offline'
import { memo, useEffect, useMemo, useState } from 'react'

import { useCorexStore, type CorexAction } from '@/stores/corex'

import {
  BUCKET_ICONS,
  BUCKET_LABELS,
  BUCKETS,
  findBucketMark,
  type Bucket
} from '@/views/directive/list/bucket'
import { DirectivePlaceholder, type PlaceholderState } from '@/views/directive/list/placeholder'
import { findPermissionIcon, findPermissionLabel } from './permissions'
import { CardSkeleton } from '@/views/directive/render/card-skeleton'
import { StreamedGrid } from '@/views/directive/render/streamed-grid'
import TrialPanel from '@/views/directive/trial/trial-panel'

/**
 * 动作库：可复用动作的只读目录（corex `list_actions`），按分类筛。
 *
 * 开合性能：
 * 1. 弹框壳先出现，首帧只铺骨架
 * 2. 分片流式挂真实卡片（idle 时段补齐）
 * 3. 单卡 `content-visibility`；参数用 `title`，试跑用原生 button（避免百个 motion Button）
 * 4. 关闭时先卸内容再关根
 */

type ActionParam = CorexAction['params'][number]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ActionCardProps {
  action: CorexAction
  onTrial: (action: CorexAction) => void
}

const LIBRARY_CHUNK = 16
const LIBRARY_GRID =
  'grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5 pb-1'
/** 首帧骨架格数：盖住首屏即可 */
const SHELL_SKELETONS = 8

function formatParamTitle(params: readonly ActionParam[]): string {
  if (params.length === 0) return '无参数'
  return params
    .map(function (param) {
      const required = param.required ? '（必填）' : ''
      const description = param.description ? ` — ${param.description}` : ''
      return `${param.name}: ${param.ty}${required}${description}`
    })
    .join('\n')
}

const ActionCard = memo(function (props: ActionCardProps) {
  const { action } = props
  const mark = findBucketMark(action.bucket)

  return (
    <Card className="h-full gap-0 py-0 shadow-none">
      <CardContent className="flex h-full flex-col gap-2 p-3">
        <div className="flex items-start gap-2.5">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon
              icon={mark.icon}
              className="size-4"
            />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{action.name}</h3>
            <Badge
              variant="outline"
              className="mt-1 font-mono">
              {action.id}
            </Badge>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{action.description}</p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-0.5">
          <div className="flex flex-wrap items-center gap-1">
            <Badge
              variant="outline"
              title={formatParamTitle(action.params)}
              className="text-xs font-normal">
              <Icon icon="mdi:form-textbox" />
              {action.params.length === 0 ? '无参数' : `${action.params.length} 个参数`}
            </Badge>
            {action.permissions.map(function (permission) {
              return (
                <Badge
                  key={permission}
                  variant="secondary"
                  className="text-xs font-normal"
                  title={`该动作会用到：${findPermissionLabel(permission)}`}>
                  <Icon icon={findPermissionIcon(permission)} />
                  {findPermissionLabel(permission)}
                </Badge>
              )
            })}
          </div>
          <button
            type="button"
            className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent-hover hover:text-accent-foreground"
            onClick={function () {
              props.onTrial(action)
            }}>
            <Icon
              icon="mdi:play-circle-outline"
              className="size-3.5"
            />
            试跑
          </button>
        </div>
      </CardContent>
    </Card>
  )
})

function ActionLibraryDialog(props: Props) {
  const catalog = useCorexStore(function (state) {
    return state.catalog
  })
  const isLoaded = useCorexStore(function (state) {
    return state.isLoaded
  })
  const loadError = useCorexStore(function (state) {
    return state.loadError
  })

  const [bucket, setBucket] = useState<Bucket | 'all'>('all')
  const [query, setQuery] = useState('')
  /** 正在试跑的动作；`null` 表示还停在目录上 */
  const [trial, setTrial] = useState<CorexAction | null>(null)
  /** 壳已画出：此后才开始流式挂卡，避免和 Dialog 进场同帧 */
  const [isShellReady, updateShellReady] = useState(false)

  // 关闭时在 render 中复位，避免 effect 内同步 setState 触发级联渲染
  if (!props.open && isShellReady) {
    updateShellReady(false)
  }

  const keyword = query.trim().toLowerCase()

  const actions = useMemo(
    function () {
      return catalog.filter(function (action) {
        if (bucket !== 'all' && action.bucket !== bucket) return false
        if (!keyword) return true
        return (
          action.name.toLowerCase().includes(keyword) ||
          action.id.toLowerCase().includes(keyword) ||
          action.tags.some(function (tag) {
            return tag.toLowerCase().includes(keyword)
          })
        )
      })
    },
    [catalog, bucket, keyword]
  )

  useEffect(
    function () {
      if (!props.open) return

      const frame = requestAnimationFrame(function () {
        updateShellReady(true)
      })
      return function () {
        cancelAnimationFrame(frame)
      }
    },
    [props.open]
  )

  const state: PlaceholderState = loadError
    ? 'error'
    : !isLoaded
      ? 'loading'
      : keyword || bucket !== 'all'
        ? 'no-match'
        : 'empty'

  const streamItems = isShellReady ? actions : []
  const streamKey = `${props.open}:${bucket}:${keyword}`

  function handleOpenChange(open: boolean): void {
    if (open) {
      props.onOpenChange(true)
      return
    }
    updateShellReady(false)
    setTrial(null)
    requestAnimationFrame(function () {
      props.onOpenChange(false)
    })
  }

  function handleTrial(action: CorexAction) {
    setTrial(action)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[min(640px,80vh)] flex-col gap-3 sm:max-w-3xl">
        {trial ? (
          <TrialPanel
            key={trial.id}
            action={trial}
            onBack={function () {
              setTrial(null)
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-1.5">
                <Icon
                  icon="mdi:view-grid-outline"
                  className="size-4"
                />
                动作库
              </DialogTitle>
              <DialogDescription>
                指令的步骤就是由这些动作拼出来的 ·{' '}
                {isLoaded ? `共 ${catalog.length} 个` : '正在读取…'}
              </DialogDescription>
            </DialogHeader>

            <div className="flex shrink-0 flex-col gap-2.5">
              <div className="relative">
                <Icon
                  icon="mdi:magnify"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={query}
                  placeholder="搜索动作 ID / 名称 / 标签…"
                  className="pl-8"
                  onChange={function (event) {
                    setQuery(event.target.value)
                  }}
                />
              </div>

              <ToggleGroup
                size="sm"
                spacing={4}
                value={[bucket]}
                aria-label="动作分类"
                onValueChange={function (value) {
                  const next = value[0]
                  if (next) setBucket(next as Bucket | 'all')
                }}
                className="flex-wrap justify-start">
                <ToggleGroupItem
                  value="all"
                  className="h-7 rounded-full px-2.5 text-xs">
                  <Icon icon="mdi:view-grid-outline" />
                  全部
                </ToggleGroupItem>
                {BUCKETS.map(function (item) {
                  return (
                    <ToggleGroupItem
                      key={item}
                      value={item}
                      className="h-7 rounded-full px-2.5 text-xs">
                      <Icon icon={BUCKET_ICONS[item]} />
                      {BUCKET_LABELS[item]}
                    </ToggleGroupItem>
                  )
                })}
              </ToggleGroup>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {!isShellReady ? (
                <div className={LIBRARY_GRID}>
                  {Array.from({ length: SHELL_SKELETONS }, function (_, index) {
                    return (
                      <CardSkeleton
                        key={`shell-bone-${index}`}
                        variant="library"
                      />
                    )
                  })}
                </div>
              ) : actions.length === 0 ? (
                <DirectivePlaceholder
                  state={state}
                  label={
                    {
                      loading: '正在读取动作目录…',
                      error: '没能读取动作目录',
                      empty: 'corex 没有返回任何动作',
                      'no-match': '没有匹配的动作'
                    }[state]
                  }
                  icon={state === 'empty' ? 'mdi:view-grid-outline' : undefined}
                  detail={state === 'error' ? loadError : null}
                  isCompact
                  actions={
                    state === 'error'
                      ? [
                          {
                            label: '重试',
                            icon: 'mdi:refresh',
                            onClick: function () {
                              void useCorexStore.getState().initialize()
                            }
                          }
                        ]
                      : state === 'no-match'
                        ? [
                            {
                              label: '清空筛选',
                              icon: 'mdi:filter-remove-outline',
                              onClick: function () {
                                setQuery('')
                                setBucket('all')
                              }
                            }
                          ]
                        : []
                  }
                />
              ) : (
                <StreamedGrid
                  items={streamItems}
                  resetKey={streamKey}
                  chunkSize={LIBRARY_CHUNK}
                  gridClassName={LIBRARY_GRID}
                  skeletonVariant="library"
                  skeletonCap={LIBRARY_CHUNK}
                  findKey={function (action) {
                    return action.id
                  }}
                  renderItem={function (action) {
                    return (
                      <ActionCard
                        action={action}
                        onTrial={handleTrial}
                      />
                    )
                  }}
                />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default ActionLibraryDialog
