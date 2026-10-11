import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'

import {
  ConvertFormatPicker,
  ConvertScalePicker
} from '@/views/morph/workspace/tasks/convert-options.tsx'
import { ConvertPreview } from '@/views/morph/workspace/tasks/convert-preview.tsx'
import { PathField } from '@/views/morph/workspace/tasks/path-field.tsx'
import { OperationStage } from '@/views/morph/workspace/tasks/stage/operation-stage.tsx'
import { MorphIpc } from '@/lib/morph-ipc'
import { useMorphStore } from '@/stores/morph.ts'

type SampleState = {
  key: string
  image: Morph.Render | null
}

function ConvertTask() {
  const format = useMorphStore(function (s) {
    return s.convertModal.format
  })
  const scale = useMorphStore(function (s) {
    return s.convertModal.scale
  })
  const destDir = useMorphStore(function (s) {
    return s.convertModal.destDir
  })
  const loading = useMorphStore(function (s) {
    return s.convertModal.loading
  })
  const error = useMorphStore(function (s) {
    return s.convertModal.error
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
  const toPatchConvert = useMorphStore(function (s) {
    return s.toPatchConvert
  })
  const toExecuteConvert = useMorphStore(function (s) {
    return s.toExecuteConvert
  })
  const toOpenFilePicker = useMorphStore(function (s) {
    return s.toOpenFilePicker
  })
  const toFetchThumbnails = useMorphStore(function (s) {
    return s.toFetchThumbnails
  })

  const isImage = format === 'png' || format === 'jpg'
  const previewKey = isImage && file ? `${file.path}:${scale}` : ''
  const [sample, updateSample] = useState<SampleState | null>(null)
  const previewImage = previewKey && sample?.key === previewKey ? sample.image : null
  const isSampleLoading = Boolean(previewKey) && sample?.key !== previewKey

  useEffect(
    function () {
      if (!file || !previewKey) return
      let cancelled = false
      void MorphIpc.toRender(file.path, 0, scale)
        .then(function (image) {
          if (!cancelled) updateSample({ key: previewKey, image })
        })
        .catch(function () {
          if (!cancelled) updateSample({ key: previewKey, image: null })
        })
      return function () {
        cancelled = true
      }
    },
    [file, previewKey, scale]
  )

  async function onSelectDir() {
    const selected = await dialogOpen({ directory: true, title: '选择输出目录' })
    if (typeof selected === 'string') toPatchConvert({ destDir: selected })
  }

  const canSubmit = Boolean(destDir) && Boolean(file)
  const meta = file
    ? `${file.path.split(/[\\/]/).pop()} · ${file.count} 页 · ${format.toUpperCase()}`
    : '请先打开 PDF'

  return (
    <OperationStage
      title="转换 PDF"
      icon="ant-design:swap-outlined"
      meta={meta}
      onBack={toCloseOperation}
      fields={
        <>
          <ConvertFormatPicker
            format={format}
            onChange={function (next) {
              toPatchConvert({ format: next })
            }}
          />
          {isImage ? (
            <ConvertScalePicker
              scale={scale}
              onChange={function (next) {
                toPatchConvert({ scale: next })
              }}
            />
          ) : null}
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
      hint={error ?? undefined}
      submitLabel="开始转换"
      submitDisabled={!canSubmit}
      submitLoading={loading}
      onSubmit={function () {
        void toExecuteConvert()
      }}>
      <ConvertPreview
        hasFile={Boolean(file)}
        isImage={isImage}
        pageCount={file?.count ?? 0}
        previewImage={previewImage}
        isSampleLoading={isSampleLoading}
        thumbnails={thumbnails}
        thumbnailsError={thumbnailsError}
        onOpenFile={function () {
          void toOpenFilePicker()
        }}
        onRetryThumbnails={function () {
          void toFetchThumbnails()
        }}
      />
    </OperationStage>
  )
}

export { ConvertTask }
