import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { save as dialogSave } from '@tauri-apps/plugin-dialog'
import { useEffect, useMemo } from 'react'

import { toggleOffset } from '@/features/magnetic-tiles/morph/page-ranges'
import { PathField } from '@/views/morph/workspace/tasks/path-field.tsx'
import { OperationStage } from '@/views/morph/workspace/tasks/stage/operation-stage.tsx'
import { PageBoard } from '@/views/morph/workspace/tasks/stage/page-board.tsx'
import styles from '@/views/morph/workspace/tasks/tasks.module.scss'
import { useMorphStore } from '@/stores/morph.ts'

function ExtractTask() {
  const file = useMorphStore(function (s) {
    return s.file
  })
  const thumbnails = useMorphStore(function (s) {
    return s.thumbnails
  })
  const thumbnailsError = useMorphStore(function (s) {
    return s.thumbnailsError
  })
  const selected = useMorphStore(function (s) {
    return s.extractModal.selected
  })
  const dest = useMorphStore(function (s) {
    return s.extractModal.dest
  })
  const loading = useMorphStore(function (s) {
    return s.extractModal.loading
  })
  const error = useMorphStore(function (s) {
    return s.extractModal.error
  })
  const toCloseOperation = useMorphStore(function (s) {
    return s.toCloseOperation
  })
  const toPatchExtract = useMorphStore(function (s) {
    return s.toPatchExtract
  })
  const toExecuteExtract = useMorphStore(function (s) {
    return s.toExecuteExtract
  })
  const toOpenFilePicker = useMorphStore(function (s) {
    return s.toOpenFilePicker
  })
  const toFetchThumbnails = useMorphStore(function (s) {
    return s.toFetchThumbnails
  })

  useEffect(
    function () {
      if (!file?.path) return
      if (!thumbnails.length && !thumbnailsError) void toFetchThumbnails()
    },
    [file, thumbnails.length, thumbnailsError, toFetchThumbnails]
  )

  const selectedOffsets = useMemo(
    function () {
      return new Set(selected)
    },
    [selected]
  )

  async function onSelectDest() {
    const selectedPath = await dialogSave({
      title: '选择抽取输出路径',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (typeof selectedPath === 'string') toPatchExtract({ dest: selectedPath })
  }

  function onOffsetClick(offset: number) {
    const next = toggleOffset(selectedOffsets, offset)
    toPatchExtract({
      selected: [...next].sort(function (a, b) {
        return a - b
      })
    })
  }

  const canSubmit = Boolean(file) && Boolean(dest) && selected.length > 0
  const meta = file
    ? `${file.path.split(/[\\/]/).pop()} · 已选 ${selected.length} 页`
    : '请先打开 PDF'

  return (
    <OperationStage
      title="抽取页面"
      icon="ant-design:export-outlined"
      meta={meta}
      onBack={toCloseOperation}
      actions={
        selected.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={function () {
              toPatchExtract({ selected: [] })
            }}>
            清空选中
          </Button>
        ) : null
      }
      extra={
        <PathField
          compact
          label="输出文件"
          value={dest}
          placeholder="抽取结果保存路径"
          onBrowse={function () {
            void onSelectDest()
          }}
        />
      }
      hint={error ?? (canSubmit ? undefined : '点选页面并选择输出路径')}
      submitLabel="开始抽取"
      submitDisabled={!canSubmit}
      submitLoading={loading}
      onSubmit={function () {
        void toExecuteExtract()
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
          thumbnails={thumbnails}
          count={file.count}
          selectedOffsets={selectedOffsets}
          isLoading={!thumbnailsError && thumbnails.length === 0}
          hasError={Boolean(thumbnailsError)}
          onRetry={function () {
            void toFetchThumbnails()
          }}
          onOffsetClick={onOffsetClick}
        />
      )}
    </OperationStage>
  )
}

export { ExtractTask }
