/**
 * 标题栏的镜像入口：切换当前工作台镜像。
 *
 * 新建 / 改名 / 改描述 / 删除等管理操作收进「管理镜像」Dialog（`mirror-manage.tsx`），
 * 下拉只负责快速切换，避免把管理面塞进标题栏 Popover。
 *
 * 三种形态：
 * - 没有镜像：直接给「新建镜像」；
 * - 有镜像：始终可点开列表切换；
 * - 切换中：触发按钮转 Spinner 并禁用。
 *
 * 列表交互：↑↓ / Home / End 移动高亮，Enter 切换高亮项；有描述时悬停延迟 Tooltip 展示（列表默认不展示描述）。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@i-thinking/design/components/popover'
import { Separator } from '@i-thinking/design/components/separator'
import { Spinner } from '@i-thinking/design/components/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@i-thinking/design/components/tooltip'
import { cn } from 'cn'
import { useEffect, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

import {
  findIsMirrorSwitching,
  requestMirrorSwitch,
  subscribeMirrorSwitching
} from '@/features/controller/mirror-switch'
import { useMirrorStore } from '@/stores/mirror.ts'
import { MirrorManageDialog } from '@/views/overview/caption/mirror-manage'
import {
  DESC_TOOLTIP_DELAY,
  buildMirrorWrite,
  findMirrorIcon,
  findNextTitle
} from '@/views/overview/caption/mirror-utils'
import styles from '@/views/overview/caption/caption.module.scss'

interface MirrorItemMainProps {
  index: number
  title: string
  description: string
  isActive: boolean
  onSelect: () => void
}

/** 列表行：默认只显示序号 + 标题；有描述时延迟 Tooltip */
function MirrorItemMain(props: MirrorItemMainProps) {
  const body = (
    <>
      <span className={styles.mirrorItemIndex}>{props.index}</span>
      <span className={styles.mirrorItemTitle}>{props.title}</span>
      {props.isActive ? (
        <Icon
          icon="lucide:check"
          className={styles.mirrorItemCheck}
          aria-hidden
        />
      ) : null}
    </>
  )

  if (!props.description) {
    return (
      <button
        type="button"
        data-region="false"
        className={styles.mirrorItemMain}
        onClick={props.onSelect}>
        {body}
      </button>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-region="false"
            className={styles.mirrorItemMain}
            onClick={props.onSelect}
          />
        }>
        {body}
      </TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={10}
        className={styles.mirrorDescTip}>
        {props.description}
      </TooltipContent>
    </Tooltip>
  )
}

function MirrorSwitcher() {
  const mirrors = useMirrorStore(function (state) {
    return state.mirrors
  })
  const activeID = useMirrorStore(function (state) {
    return state.active.mirror?.id
  })
  const [isBusy, updateBusy] = useState(findIsMirrorSwitching)
  const [isOpen, updateOpen] = useState(false)
  const [isManageOpen, updateManageOpen] = useState(false)
  const [cursor, updateCursor] = useState(0)

  useEffect(function () {
    return subscribeMirrorSwitching(function () {
      updateBusy(findIsMirrorSwitching())
    })
  }, [])

  const sorted = mirrors.slice().toSorted(function (a, b) {
    return a.index - b.index
  })
  const activeIndex = sorted.findIndex(function (mirror) {
    return mirror.id === activeID
  })
  const active = activeIndex >= 0 ? sorted[activeIndex] : undefined

  function handleOpenChange(next: boolean) {
    updateOpen(next)
    if (next) updateCursor(activeIndex >= 0 ? activeIndex : 0)
  }

  async function switchTo(id: string) {
    updateOpen(false)
    await requestMirrorSwitch(id)
  }

  async function handleCreate() {
    const write = buildMirrorWrite(findNextTitle(sorted), sorted.length)
    try {
      await useMirrorStore.getState().toInsertMirror([write])
    } catch (error) {
      console.error('[caption-mirror] 新建镜像失败', error)
      toast.error('新建镜像失败')
      return
    }

    const created = useMirrorStore.getState().mirrors.find(function (mirror) {
      return mirror.index === write.index && mirror.title === write.title
    })
    if (created) await switchTo(created.id)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      updateCursor(function (current) {
        return (current + step + sorted.length) % sorted.length
      })
      return
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      updateCursor(event.key === 'Home' ? 0 : sorted.length - 1)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const target = sorted[cursor]
      if (target && target.id !== activeID) void switchTo(target.id)
    }
  }

  if (!active) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          data-region="false"
          className={styles.mirrorTrigger}
          disabled={isBusy}
          onClick={function () {
            void handleCreate()
          }}>
          {isBusy ? (
            <Spinner className="size-3.5" />
          ) : (
            <Icon
              icon="lucide:plus"
              aria-hidden
            />
          )}
          新建镜像
        </Button>
        <MirrorManageDialog
          open={isManageOpen}
          onOpenChange={updateManageOpen}
        />
      </>
    )
  }

  const label = active.description ? `${active.title}：${active.description}` : active.title

  return (
    <>
      <Popover
        open={isOpen}
        onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              data-region="false"
              className={cn(styles.mirrorTrigger, isOpen && styles.mirrorTriggerOpen)}
              aria-label={`镜像：${label}`}
              aria-busy={isBusy || undefined}
              disabled={isBusy}
            />
          }>
          {isBusy ? (
            <Spinner className="size-3.5" />
          ) : (
            <Icon
              icon={findMirrorIcon(active.mark)}
              className={styles.mirrorTriggerIcon}
              aria-hidden
            />
          )}
          <span className={styles.mirrorPage}>{active.index + 1}</span>
          <span className={styles.mirrorName}>{active.title}</span>
          <Icon
            icon="lucide:chevron-down"
            className={cn(styles.mirrorChevron, isOpen && styles.mirrorChevronOpen)}
            aria-hidden
          />
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={6}
          className={cn(styles.mirrorList, 'gap-0 p-1')}
          onKeyDown={onKeyDown}>
          <TooltipProvider delay={DESC_TOOLTIP_DELAY}>
            <div
              role="listbox"
              aria-label="镜像"
              className={styles.mirrorOptions}
              data-scrollable={sorted.length > 6 ? 'true' : undefined}>
              {sorted.map(function (mirror, index) {
                const isActive = mirror.id === activeID
                const isCursor = index === cursor
                const description = mirror.description?.trim() ?? ''
                return (
                  <div
                    key={mirror.id}
                    role="option"
                    tabIndex={isCursor ? 0 : -1}
                    aria-selected={isActive}
                    data-cursor={isCursor ? 'true' : undefined}
                    data-active={isActive ? 'true' : undefined}
                    className={cn(styles.mirrorItem, isActive && styles.mirrorItemActive)}
                    onMouseEnter={function () {
                      updateCursor(index)
                    }}
                    onKeyDown={function (event) {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      if (isActive) {
                        updateOpen(false)
                        return
                      }
                      void switchTo(mirror.id)
                    }}>
                    <MirrorItemMain
                      index={mirror.index + 1}
                      title={mirror.title}
                      description={description}
                      isActive={isActive}
                      onSelect={function () {
                        if (isActive) {
                          updateOpen(false)
                          return
                        }
                        void switchTo(mirror.id)
                      }}
                    />
                  </div>
                )
              })}
            </div>
          </TooltipProvider>

          <Separator className={styles.mirrorDivider} />

          <button
            type="button"
            data-region="false"
            className={styles.mirrorCreate}
            onClick={function () {
              void handleCreate()
            }}>
            <Icon
              icon="lucide:plus"
              aria-hidden
            />
            新建镜像
          </button>

          <button
            type="button"
            data-region="false"
            className={styles.mirrorManageEntry}
            onClick={function () {
              updateOpen(false)
              updateManageOpen(true)
            }}>
            <Icon
              icon="lucide:settings-2"
              aria-hidden
            />
            管理镜像
          </button>
        </PopoverContent>
      </Popover>

      <MirrorManageDialog
        open={isManageOpen}
        onOpenChange={updateManageOpen}
      />
    </>
  )
}

export { MirrorSwitcher }
