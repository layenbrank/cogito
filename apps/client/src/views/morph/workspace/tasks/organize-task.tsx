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
import { save as dialogSave } from '@tauri-apps/plugin-dialog'
import { useEffect, useMemo, useState } from 'react'

import { toggleOffset } from '@/features/magnetic-tiles/morph/page-ranges'
import { PathField } from '@/views/morph/workspace/tasks/path-field.tsx'
import { OperationStage } from '@/views/morph/workspace/tasks/stage/operation-stage.tsx'
import { PageBoard } from '@/views/morph/workspace/tasks/stage/page-board.tsx'
import styles from '@/views/morph/workspace/tasks/tasks.module.scss'
import { useMorphStore } from '@/stores/morph.ts'

function OrganizeTask() {
  const file = useMorphStore(function (s) {
    return s.file
  })
  const thumbnails = useMorphStore(function (s) {
    return s.thumbnails
  })
  const thumbnailsError = useMorphStore(function (s) {
    return s.thumbnailsError
  })
  const [isConfirmOpen, setConfirmOpen] = useState(false)
  const order = useMorphStore(function (s) {
    return s.organizeModal.order
  })
  const selected = useMorphStore(function (s) {
    return s.organizeModal.selected
  })
  const dest = useMorphStore(function (s) {
    return s.organizeModal.dest
  })
  const loading = useMorphStore(function (s) {
    return s.organizeModal.loading
  })
  const error = useMorphStore(function (s) {
    return s.organizeModal.error
  })
  const toCloseOperation = useMorphStore(function (s) {
    return s.toCloseOperation
  })
  const toPatchOrganize = useMorphStore(function (s) {
    return s.toPatchOrganize
  })
  const toExecuteOrganize = useMorphStore(function (s) {
    return s.toExecuteOrganize
  })
  const toOpenFilePicker = useMorphStore(function (s) {
    return s.toOpenFilePicker
  })
  const toFetchThumbnails = useMorphStore(function (s) {
    return s.toFetchThumbnails
  })

  useEffect(
    function () {
      const count = file?.count ?? 0
      if (!count) return
      if (order.length === count) return
      toPatchOrganize({
        order: Array.from({ length: count }, function (_, i) {
          return i
        }),
        selected: []
      })
      if (!thumbnails.length) void toFetchThumbnails()
    },
    [file?.count, file?.path, order.length, toPatchOrganize, thumbnails.length, toFetchThumbnails]
  )

  const images = useMemo(
    function () {
      if (!order.length) return thumbnails
      const byOffset = new Map(
        thumbnails.map(function (image) {
          return [image.offset, image] as const
        })
      )
      return order
        .map(function (offset) {
          return byOffset.get(offset)
        })
        .filter(Boolean) as Morph.Render[]
    },
    [order, thumbnails]
  )

  const selectedOffsets = useMemo(
    function () {
      return new Set(selected)
    },
    [selected]
  )

  async function onSelectDest() {
    const selectedPath = await dialogSave({
      title: '选择整理后的输出路径',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (typeof selectedPath === 'string') toPatchOrganize({ dest: selectedPath })
  }

  function onOffsetClick(offset: number) {
    const next = toggleOffset(selectedOffsets, offset)
    toPatchOrganize({ selected: [...next] })
  }

  /** 按当前 order 位置移动，跳过同属选中的邻居 */
  function onMoveSelected(delta: number) {
    if (!selected.length) return
    const next = order.slice()
    const selectedSet = new Set(selected)
    const positions = selected
      .map(function (offset) {
        return next.indexOf(offset)
      })
      .filter(function (i) {
        return i >= 0
      })
      .sort(function (a, b) {
        return delta < 0 ? a - b : b - a
      })
    for (const index of positions) {
      const target = index + delta
      if (target < 0 || target >= next.length) continue
      if (selectedSet.has(next[target])) continue
      const temp = next[index]
      next[index] = next[target]
      next[target] = temp
    }
    toPatchOrganize({ order: next })
  }

  function onConfirmDelete() {
    setConfirmOpen(true)
  }

  const canSubmit = Boolean(file) && Boolean(dest) && order.length > 0
  const canPageOp = Boolean(dest) && selected.length > 0 && !loading
  const meta = file
    ? `${file.path.split(/[\\/]/).pop()} · 已选 ${selected.length} / ${file.count} 页`
    : '请先打开 PDF'

  return (
    <OperationStage
      title="整理页面"
      icon="ant-design:appstore-outlined"
      meta={meta}
      onBack={toCloseOperation}
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            disabled={!selected.length}
            onClick={function () {
              onMoveSelected(-1)
            }}>
            <Icon
              icon="ant-design:arrow-up-outlined"
              className="size-3.5"
            />
            上移
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!selected.length}
            onClick={function () {
              onMoveSelected(1)
            }}>
            <Icon
              icon="ant-design:arrow-down-outlined"
              className="size-3.5"
            />
            下移
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!canPageOp}
            onClick={function () {
              void toExecuteOrganize('rotate')
            }}>
            <Icon
              icon="ant-design:rotate-right-outlined"
              className="size-3.5"
            />
            旋转
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!canPageOp}
            onClick={onConfirmDelete}>
            <Icon
              icon="ant-design:delete-outlined"
              className="size-3.5"
            />
            删除
          </Button>
        </>
      }
      extra={
        <PathField
          compact
          label="输出文件"
          value={dest}
          placeholder="整理结果保存路径"
          onBrowse={function () {
            void onSelectDest()
          }}
        />
      }
      hint={error ?? (canSubmit ? undefined : '选择输出路径后保存重排')}
      submitLabel="保存重排"
      submitDisabled={!canSubmit}
      submitLoading={loading}
      onSubmit={function () {
        void toExecuteOrganize('reorder')
      }}>
      {!file ? (
        <div className={styles.stageEmpty}>
          <div className={styles.notice}>
            <Icon
              icon="ant-design:info-circle-outlined"
              className="size-4"
            />
            <span className={styles.noticeText}>请先打开一个 PDF</span>
            <Button
              variant="link"
              size="sm"
              onClick={function () {
                void toOpenFilePicker()
              }}>
              打开 PDF
            </Button>
          </div>
        </div>
      ) : (
        <PageBoard
          thumbnails={images}
          count={file.count}
          selectedOffsets={selectedOffsets}
          offsetLabel={function (_offset, gridIndex) {
            return String(gridIndex + 1)
          }}
          isLoading={!thumbnailsError && thumbnails.length === 0}
          hasError={Boolean(thumbnailsError)}
          onRetry={function () {
            void toFetchThumbnails()
          }}
          onOffsetClick={onOffsetClick}
        />
      )}
      <AlertDialog
        open={isConfirmOpen}
        onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除选中页面？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除 {selected.length} 页并写入输出文件，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={function () {
                void toExecuteOrganize('delete')
              }}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </OperationStage>
  )
}

export { OrganizeTask }
