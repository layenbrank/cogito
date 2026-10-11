import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { ToggleGroup, ToggleGroupItem } from '@i-thinking/design/components/toggle-group'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { useMemo } from 'react'

import {
  buildRangesFromOffsets,
  parseRangesToOffsets,
  toggleOffset
} from '@/features/magnetic-tiles/morph/page-ranges'
import {
  canSplitSubmit,
  findSplitMeta
} from '@/views/morph/workspace/tasks/split-task-copy.ts'
import { PathField } from '@/views/morph/workspace/tasks/path-field.tsx'
import { OperationStage } from '@/views/morph/workspace/tasks/stage/operation-stage.tsx'
import { PageBoard } from '@/views/morph/workspace/tasks/stage/page-board.tsx'
import styles from '@/views/morph/workspace/tasks/tasks.module.scss'
import { useMorphStore } from '@/stores/morph.ts'

const RANGE_EXAMPLES = ['1-3, 4-6', '1-5', '7-10, 11-15']

function SplitTask() {
  const mode = useMorphStore(function (s) {
    return s.splitModal.mode
  })
  const ranges = useMorphStore(function (s) {
    return s.splitModal.ranges
  })
  const limit = useMorphStore(function (s) {
    return s.splitModal.limit
  })
  const destDir = useMorphStore(function (s) {
    return s.splitModal.destDir
  })
  const loading = useMorphStore(function (s) {
    return s.splitModal.loading
  })
  const error = useMorphStore(function (s) {
    return s.splitModal.error
  })
  const file = useMorphStore(function (s) {
    return s.file
  })
  const thumbnails = useMorphStore(function (s) {
    return s.thumbnails
  })
  const thumbnailsError = useMorphStore(function (s) {
    return s.thumbnailsError
  })
  const toCloseOperation = useMorphStore(function (s) {
    return s.toCloseOperation
  })
  const toPatchSplit = useMorphStore(function (s) {
    return s.toPatchSplit
  })
  const toExecuteSplit = useMorphStore(function (s) {
    return s.toExecuteSplit
  })
  const toOpenFilePicker = useMorphStore(function (s) {
    return s.toOpenFilePicker
  })
  const toFetchThumbnails = useMorphStore(function (s) {
    return s.toFetchThumbnails
  })

  const count = file?.count ?? 0
  const selectedOffsets = useMemo(
    function () {
      if (mode !== 'ranges' || !count) return new Set<number>()
      return new Set(parseRangesToOffsets(ranges, count))
    },
    [mode, ranges, count]
  )

  async function onSelectDir() {
    const selected = await dialogOpen({ directory: true, title: '选择输出目录' })
    if (typeof selected === 'string') toPatchSplit({ destDir: selected })
  }

  function onOffsetClick(offset: number) {
    if (mode !== 'ranges') return
    const next = toggleOffset(selectedOffsets, offset)
    toPatchSplit({ ranges: buildRangesFromOffsets([...next]) })
  }

  function offsetGroup(offset: number) {
    if (mode !== 'limit' || limit <= 0) return null
    return Math.floor(offset / limit)
  }

  const canSubmit = canSplitSubmit(
    Boolean(destDir),
    Boolean(file),
    mode,
    limit,
    selectedOffsets.size
  )
  const meta = findSplitMeta(Boolean(file), mode, selectedOffsets.size, count, limit)

  return (
    <OperationStage
      title="拆分 PDF"
      icon="ant-design:scissor-outlined"
      meta={meta}
      onBack={toCloseOperation}
      actions={
        mode === 'ranges' && selectedOffsets.size > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={function () {
              toPatchSplit({ ranges: '' })
            }}>
            清空选中
          </Button>
        ) : null
      }
      fields={
        <>
          <ToggleGroup
            size="sm"
            spacing={0}
            variant="outline"
            value={[mode]}
            onValueChange={function (value) {
              const next = value[0]
              if (next === 'ranges' || next === 'limit') toPatchSplit({ mode: next })
            }}>
            <ToggleGroupItem
              value="ranges"
              className={styles.segmentItem}>
              页码范围
            </ToggleGroupItem>
            <ToggleGroupItem
              value="limit"
              className={styles.segmentItem}>
              固定页数
            </ToggleGroupItem>
          </ToggleGroup>
          {mode === 'limit' ? (
            <label className={styles.limitField}>
              <input
                type="number"
                aria-label="每文件页数"
                min={1}
                max={file?.count ?? 9999}
                value={limit}
                className={styles.limitInput}
                onChange={function (event) {
                  const next = event.target.valueAsNumber
                  toPatchSplit({ limit: Number.isFinite(next) ? next : 1 })
                }}
              />
              <span>页/文件</span>
            </label>
          ) : (
            <div className={styles.footerChips}>
              {RANGE_EXAMPLES.map(function (example) {
                return (
                  <button
                    key={example}
                    type="button"
                    className={styles.chip}
                    onClick={function () {
                      toPatchSplit({ ranges: example })
                    }}>
                    {example}
                  </button>
                )
              })}
            </div>
          )}
        </>
      }
      extra={
        <PathField
          compact
          label="输出目录"
          value={destDir}
          placeholder="选择输出目录"
          onBrowse={function () {
            void onSelectDir()
          }}
        />
      }
      hint={error ?? (canSubmit ? undefined : '完善输出与范围后即可拆分')}
      submitLabel="开始拆分"
      submitDisabled={!canSubmit}
      submitLoading={loading}
      onSubmit={function () {
        void toExecuteSplit()
      }}>
      {!file ? (
        <div className={styles.stageEmpty}>
          <div className={styles.notice}>
            <Icon
              icon="ant-design:info-circle-outlined"
              className="size-4"
            />
            <span className={styles.noticeText}>请先打开一个 PDF，再进行拆分</span>
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
          count={count}
          selectedOffsets={mode === 'ranges' ? selectedOffsets : undefined}
          resolveGroup={mode === 'limit' ? offsetGroup : undefined}
          isLoading={!thumbnails.length && !thumbnailsError}
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

export { SplitTask }
