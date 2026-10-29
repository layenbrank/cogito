/**
 * 镜像管理 Dialog。
 *
 * 对齐 SeaORM `mirror` 表可编辑字段：
 * - mark：图标标识（Iconify 名）
 * - title / description：名称与描述
 * - background.color：背景色（JSON 列）
 * overlay / backdrop 暂不在此暴露（高级外观）。
 *
 * 左列是镜像列表，右列只有一份图标和背景色，改的是左列选中的那条。
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
} from '@cogito/design/components/alert-dialog'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Input } from '@cogito/design/components/input'
import { cn } from 'cn'
import { useState } from 'react'
import { toast } from 'sonner'

import { requestMirrorSwitch } from '@/features/controller/mirror-switch'
import { useMirrorStore } from '@/stores/mirror.ts'
import {
  MIRROR_COLOR_PRESETS,
  MIRROR_MARK_ICONS,
  buildMirrorWrite,
  findAccent,
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
  isChosen: boolean
  canRemove: boolean
  onChoose: () => void
  onCommit: (change: MirrorChange) => void
  onRemove: () => void
}

function MirrorEditor(props: MirrorEditorProps) {
  const { mirror } = props
  const icon = findMirrorIcon(mirror.mark)
  const accent = findAccent(mirror.background)

  return (
    <article
      className={cn(styles.mirrorManageItem, props.isChosen && styles.mirrorManageItemActive)}
      data-active={props.isActive ? 'true' : undefined}
      data-chosen={props.isChosen ? 'true' : undefined}
      onClick={props.onChoose}>
      {/* 两列顶对齐：图标（角标序号）| 字段栈，避免左侧序号列形成灰条 */}
      <div className={styles.mirrorManageRow}>
        <span
          className={styles.mirrorManageMark}
          style={accent ? { backgroundColor: accent } : undefined}
          aria-hidden>
          <span className={styles.mirrorManageIndex}>{mirror.index + 1}</span>
          <Icon
            icon={icon}
            className={styles.mirrorManageMarkIcon}
          />
        </span>

        <div className={styles.mirrorManageMain}>
          <div className={styles.mirrorManageTitleRow}>
            <Input
              data-region="false"
              className={cn(
                styles.mirrorManageTitle,
                'h-8 border-transparent bg-transparent px-1.5 text-sm shadow-none hover:bg-muted/60'
              )}
              defaultValue={mirror.title}
              key={`${mirror.id}-title-${mirror.title}`}
              placeholder="名称"
              aria-label={`「${mirror.title}」名称`}
              onFocus={props.onChoose}
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
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                data-region="false"
                className={styles.mirrorManageRemove}
                aria-label={`删除「${mirror.title}」`}
                onClick={function (event) {
                  event.stopPropagation()
                  props.onRemove()
                }}>
                <Icon
                  icon="lucide:trash-2"
                  aria-hidden
                />
              </Button>
            ) : null}
          </div>

          <Input
            data-region="false"
            className={cn(
              styles.mirrorManageDesc,
              'h-7 border-transparent bg-transparent px-1.5 text-[13px] shadow-none hover:bg-muted/60'
            )}
            defaultValue={mirror.description ?? ''}
            key={`${mirror.id}-desc-${mirror.description ?? ''}`}
            placeholder="描述（可选）"
            aria-label={`「${mirror.title}」描述`}
            onFocus={props.onChoose}
            onBlur={function (event) {
              const description = event.target.value.trim()
              if (description === (mirror.description ?? '')) return
              props.onCommit({ description })
            }}
          />
        </div>
      </div>
    </article>
  )
}

function MirrorAppearance(props: { mirror: Mirror; onCommit: (change: MirrorChange) => void }) {
  const icon = findMirrorIcon(props.mirror.mark)
  const accent = findAccent(props.mirror.background)

  return (
    <div className={styles.mirrorMarkInline}>
      <p className={styles.mirrorMarkInlineTitle}>外观 · {props.mirror.title}</p>
      <p className={styles.mirrorAppearanceLabel}>背景</p>
      <div
        className={styles.mirrorManageSwatches}
        role="listbox"
        aria-label={`「${props.mirror.title}」背景色`}>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
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
            props.onCommit({ background: { color: '' } })
          }}
        />
        {MIRROR_COLOR_PRESETS.map(function (preset) {
          const isOn = accent === preset.value
          return (
            <Button
              key={preset.value}
              type="button"
              variant="ghost"
              size="icon-xs"
              data-region="false"
              role="option"
              aria-selected={isOn}
              aria-label={preset.label}
              title={preset.label}
              className={cn(styles.mirrorManageSwatch, isOn && styles.mirrorManageSwatchActive)}
              style={{ backgroundColor: preset.value }}
              onClick={function () {
                if (isOn) return
                props.onCommit({ background: { color: preset.value } })
              }}
            />
          )
        })}
      </div>
      <p className={styles.mirrorAppearanceLabel}>图标</p>
      <div
        className={styles.mirrorMarkGrid}
        role="listbox"
        aria-label={`「${props.mirror.title}」图标`}>
        {MIRROR_MARK_ICONS.map(function (item) {
          const isOn = icon === item
          return (
            <Button
              key={item}
              type="button"
              variant="ghost"
              size="icon-sm"
              data-region="false"
              role="option"
              aria-selected={isOn}
              className={cn(styles.mirrorMarkOption, isOn && styles.mirrorMarkOptionActive)}
              aria-label={item}
              onClick={function () {
                if (item === props.mirror.mark) return
                props.onCommit({ mark: item })
              }}>
              <Icon
                icon={item}
                aria-hidden
              />
            </Button>
          )
        })}
      </div>
    </div>
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
  const [markID, updateMarkID] = useState<string | null>(null)
  const sorted = mirrors.slice().toSorted(function (a, b) {
    return a.index - b.index
  })
  const canRemove = sorted.length > 1
  const editing =
    sorted.find(function (mirror) {
      return mirror.id === markID
    }) ??
    sorted.find(function (mirror) {
      return mirror.id === activeID
    }) ??
    sorted[0]

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
    if (!created) return
    updateMarkID(created.id)
    await requestMirrorSwitch(created.id)
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

    if (markID === target.id) updateMarkID(null)
    if (target.id !== activeID) return
    const remaining = useMirrorStore.getState().mirrors[0]
    if (remaining) await requestMirrorSwitch(remaining.id)
  }

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={function (next) {
          if (!next) updateMarkID(null)
          props.onOpenChange(next)
        }}>
        <DialogContent
          className={cn(
            styles.mirrorManage,
            'h-[min(86vh,52rem)] max-h-[min(86vh,52rem)] w-[min(94vw,76rem)] max-w-none gap-0 p-0 sm:max-w-[min(94vw,76rem)]'
          )}
          data-region="false">
          <DialogHeader className={cn(styles.mirrorManageHeader, 'gap-1.5 px-4 pt-4 pb-3.5')}>
            <DialogTitle>管理镜像</DialogTitle>
            <DialogDescription>名称和描述失焦后保存，图标与背景色点选即存。</DialogDescription>
          </DialogHeader>

          <div className={styles.mirrorManageBody}>
            <div className={styles.mirrorManageSide}>
              <div className={styles.mirrorManageList}>
                {sorted.map(function (mirror) {
                  return (
                    <MirrorEditor
                      key={mirror.id}
                      mirror={mirror}
                      isActive={mirror.id === activeID}
                      isChosen={mirror.id === editing?.id}
                      canRemove={canRemove}
                      onChoose={function () {
                        updateMarkID(mirror.id)
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
              <div className={styles.mirrorManageFooter}>
                <Button
                  type="button"
                  variant="outline"
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
              </div>
            </div>

            {editing ? (
              <MirrorAppearance
                mirror={editing}
                onCommit={function (change) {
                  void commitField(editing.id, change)
                }}
              />
            ) : null}
          </div>
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
