/**
 * 镜像管理 Dialog。
 *
 * 对齐 SeaORM `mirror` 表可编辑字段：
 * - mark：图标标识（Iconify 名）
 * - title / description：名称与描述
 * - background.color：背景色（JSON 列）
 * overlay / backdrop 暂不在此暴露（高级外观）。
 *
 * 图标选择用行内展开，避免 Dialog 内嵌 Popover 被遮挡 / 焦点陷阱吃掉点击。
 */
import { Icon } from '@iconify/react/offline'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@i-thinking/design/components/alert-dialog'
import { Button } from '@i-thinking/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@i-thinking/design/components/dialog'
import { Input } from '@i-thinking/design/components/input'
import { cn } from 'cn'
import { useState } from 'react'
import { toast } from 'sonner'

import { requestMirrorSwitch } from '@/features/controller/mirror-switch'
import { useMirrorStore } from '@/stores/mirror.ts'
import {
  MIRROR_COLOR_PRESETS,
  MIRROR_MARK_ICONS,
  buildMirrorWrite,
  findMirrorIcon,
  findNextTitle
} from '@/views/overview/caption/mirror-utils'
import styles from '@/views/overview/caption/caption.module.scss'

interface MirrorManageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type MirrorChange = Pick<Mirror.Change, 'title' | 'description' | 'mark' | 'background'>

interface MirrorEditorProps {
  mirror: Mirror
  isActive: boolean
  canRemove: boolean
  isPickingMark: boolean
  onToggleMarkPicker: () => void
  onCommit: (change: MirrorChange) => void
  onRemove: () => void
}

function MirrorEditor(props: MirrorEditorProps) {
  const { mirror } = props
  const icon = findMirrorIcon(mirror.mark)
  const accent = mirror.background?.color ?? null

  return (
    <article
      className={cn(styles.mirrorManageItem, props.isActive && styles.mirrorManageItemActive)}
      data-active={props.isActive ? 'true' : undefined}>
      {/* 两列顶对齐：图标（角标序号）| 字段栈，避免左侧序号列形成灰条 */}
      <div className={styles.mirrorManageRow}>
        <button
          type="button"
          data-region="false"
          className={cn(styles.mirrorManageMark, props.isPickingMark && styles.mirrorManageMarkOpen)}
          style={accent ? { backgroundColor: accent } : undefined}
          aria-label={`选择「${mirror.title}」图标`}
          aria-expanded={props.isPickingMark}
          aria-controls={`mirror-mark-grid-${mirror.id}`}
          title="选择图标"
          onClick={props.onToggleMarkPicker}>
          <span
            className={styles.mirrorManageIndex}
            aria-hidden>
            {mirror.index + 1}
          </span>
          <Icon
            icon={icon}
            className={styles.mirrorManageMarkIcon}
            aria-hidden
          />
          <span
            className={styles.mirrorManageMarkEdit}
            aria-hidden>
            <Icon
              icon={props.isPickingMark ? 'lucide:chevron-up' : 'lucide:pencil'}
            />
          </span>
        </button>

        <div className={styles.mirrorManageMain}>
          <div className={styles.mirrorManageTitleRow}>
            <Input
              data-region="false"
              className={styles.mirrorManageTitle}
              defaultValue={mirror.title}
              key={`${mirror.id}-title-${mirror.title}`}
              placeholder="名称"
              aria-label={`「${mirror.title}」名称`}
              onBlur={function (event) {
                const title = event.target.value.trim()
                if (!title || title === mirror.title) {
                  if (!title) event.target.value = mirror.title
                  return
                }
                props.onCommit({ title })
              }}
            />
            {props.isActive ? <span className={styles.mirrorManageBadge}>当前</span> : null}
            {props.canRemove ? (
              <button
                type="button"
                data-region="false"
                className={styles.mirrorManageRemove}
                aria-label={`删除「${mirror.title}」`}
                onClick={props.onRemove}>
                <Icon
                  icon="lucide:trash-2"
                  aria-hidden
                />
              </button>
            ) : null}
          </div>

          <Input
            data-region="false"
            className={styles.mirrorManageDesc}
            defaultValue={mirror.description ?? ''}
            key={`${mirror.id}-desc-${mirror.description ?? ''}`}
            placeholder="描述（可选）"
            aria-label={`「${mirror.title}」描述`}
            onBlur={function (event) {
              const description = event.target.value.trim()
              if (description === (mirror.description ?? '')) return
              props.onCommit({ description })
            }}
          />

          <div
            className={styles.mirrorManageSwatches}
            role="listbox"
            aria-label={`「${mirror.title}」背景色`}>
            <button
              type="button"
              data-region="false"
              role="option"
              aria-selected={!accent}
              aria-label="无背景色"
              title="无背景"
              className={cn(
                styles.mirrorManageSwatch,
                styles.mirrorManageSwatchClear,
                !accent && styles.mirrorManageSwatchActive
              )}
              onClick={function () {
                if (!accent) return
                props.onCommit({ background: null })
              }}
            />
            {MIRROR_COLOR_PRESETS.map(function (preset) {
              const isActiveColor = accent === preset.value
              return (
                <button
                  key={preset.value}
                  type="button"
                  data-region="false"
                  role="option"
                  aria-selected={isActiveColor}
                  aria-label={preset.label}
                  title={preset.label}
                  className={cn(
                    styles.mirrorManageSwatch,
                    isActiveColor && styles.mirrorManageSwatchActive
                  )}
                  style={{ backgroundColor: preset.value }}
                  onClick={function () {
                    if (isActiveColor) return
                    props.onCommit({ background: { color: preset.value } })
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>

      {props.isPickingMark ? (
        <div
          id={`mirror-mark-grid-${mirror.id}`}
          className={styles.mirrorMarkInline}
          role="listbox"
          aria-label="镜像图标">
          <div className={styles.mirrorMarkGrid}>
            {MIRROR_MARK_ICONS.map(function (item) {
              const isActive = icon === item
              return (
                <button
                  key={item}
                  type="button"
                  data-region="false"
                  role="option"
                  aria-selected={isActive}
                  className={cn(styles.mirrorMarkOption, isActive && styles.mirrorMarkOptionActive)}
                  aria-label={item}
                  onClick={function () {
                    if (item !== mirror.mark) props.onCommit({ mark: item })
                    props.onToggleMarkPicker()
                  }}>
                  <Icon
                    icon={item}
                    aria-hidden
                  />
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </article>
  )
}

function MirrorManageDialog(props: MirrorManageDialogProps) {
  const mirrors = useMirrorStore(function (state) {
    return state.mirrors
  })
  const activeID = useMirrorStore(function (state) {
    return state.active.mirror?.id
  })
  const [pendingRemove, updatePendingRemove] = useState<Mirror | null>(null)
  const [pickingMarkID, updatePickingMarkID] = useState<string | null>(null)
  const sorted = mirrors.slice().toSorted(function (a, b) {
    return a.index - b.index
  })
  const canRemove = sorted.length > 1

  async function handleCreate() {
    const write = buildMirrorWrite(findNextTitle(sorted), sorted.length)
    try {
      await useMirrorStore.getState().toInsertMirror([write])
    } catch (error) {
      console.error('[mirror-manage] 新建镜像失败', error)
      toast.error('新建镜像失败')
      return
    }

    const created = useMirrorStore.getState().mirrors.find(function (mirror) {
      return mirror.index === write.index && mirror.title === write.title
    })
    if (created) await requestMirrorSwitch(created.id)
  }

  async function commitField(id: string, change: MirrorChange) {
    if (!Object.keys(change).length) return
    try {
      await useMirrorStore.getState().toUpdateMirror([{ key: id, change }])
    } catch (error) {
      console.error('[mirror-manage] 更新镜像失败', error)
      toast.error('更新镜像失败')
    }
  }

  async function handleRemove(target: Mirror) {
    updatePendingRemove(null)
    if (sorted.length <= 1) {
      toast.error('至少保留一个镜像')
      return
    }

    try {
      await useMirrorStore.getState().toRemoveMirror([target.id])
    } catch (error) {
      console.error('[mirror-manage] 删除镜像失败', error)
      toast.error('删除镜像失败')
      return
    }

    if (pickingMarkID === target.id) updatePickingMarkID(null)
    if (target.id !== activeID) return
    const remaining = useMirrorStore.getState().mirrors[0]
    if (remaining) await requestMirrorSwitch(remaining.id)
  }

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={function (next) {
          if (!next) updatePickingMarkID(null)
          props.onOpenChange(next)
        }}>
        <DialogContent
          className={cn(styles.mirrorManage, 'gap-0 p-0 sm:max-w-[420px]')}
          data-region="false">
          <DialogHeader className={styles.mirrorManageHeader}>
            <DialogTitle>管理镜像</DialogTitle>
            <DialogDescription>点图标换标记；名称、描述与背景失焦即存。</DialogDescription>
          </DialogHeader>

          <div className={styles.mirrorManageList}>
            {sorted.map(function (mirror) {
              return (
                <MirrorEditor
                  key={mirror.id}
                  mirror={mirror}
                  isActive={mirror.id === activeID}
                  canRemove={canRemove}
                  isPickingMark={pickingMarkID === mirror.id}
                  onToggleMarkPicker={function () {
                    updatePickingMarkID(function (current) {
                      return current === mirror.id ? null : mirror.id
                    })
                  }}
                  onCommit={function (change) {
                    void commitField(mirror.id, change)
                  }}
                  onRemove={function () {
                    updatePendingRemove(mirror)
                  }}
                />
              )
            })}
          </div>

          <DialogFooter className={styles.mirrorManageFooter}>
            <Button
              type="button"
              variant="ghost"
              data-region="false"
              className={styles.mirrorManageCreate}
              onClick={function () {
                void handleCreate()
              }}>
              <Icon
                icon="lucide:plus"
                aria-hidden
              />
              新建镜像
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={function (next) {
          if (!next) updatePendingRemove(null)
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除镜像</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{pendingRemove?.title}」及其中的全部磁贴，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={function () {
                if (pendingRemove) void handleRemove(pendingRemove)
              }}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export { MirrorManageDialog }
