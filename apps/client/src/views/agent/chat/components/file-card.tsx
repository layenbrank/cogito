/**
 * 文件部件：上下文文件卡片，支持按需加载预览
 */
import { Icon } from '@iconify/react/offline'
import { Badge } from '@i-thinking/design/components/badge'
import { Button } from '@i-thinking/design/components/button'
import { Spinner } from '@i-thinking/design/components/spinner'
import { useState } from 'react'

import type { FilePartData } from '@/features/agent/types'
import { FileIpc } from '@/lib/file-ipc'

interface FileCardProps {
  data: FilePartData
}

function formatSize(size?: number) {
  if (size === undefined) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function FileCard(props: FileCardProps) {
  const { data } = props
  const [preview, updatePreview] = useState<string | null>(null)
  const [loading, updateLoading] = useState(false)

  async function handleTogglePreview() {
    if (preview !== null) {
      updatePreview(null)
      return
    }
    updateLoading(true)
    try {
      updatePreview(await FileIpc.read(data.path))
    } catch (error) {
      // 已把失败原文写进预览区给用户看，这里再补一条控制台留痕
      console.warn('[file-card] 读取文件预览失败:', error)
      updatePreview(`读取失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      updateLoading(false)
    }
  }

  return (
    <div className="border-border bg-card flex flex-col gap-1.5 rounded-lg border px-3 py-2">
      <div className="flex items-center gap-2">
        <Icon
          icon="lucide:file-text"
          className="text-muted-foreground size-4 shrink-0"
        />
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium"
          title={data.path}>
          {data.name}
        </span>
        {data.size !== undefined && <Badge variant="secondary">{formatSize(data.size)}</Badge>}
        <Button
          variant="ghost"
          size="sm"
          onClick={function () {
            void handleTogglePreview()
          }}>
          {preview !== null ? '收起' : '预览'}
        </Button>
      </div>
      <span
        className="text-muted-foreground truncate text-xs"
        title={data.path}>
        {data.path}
      </span>
      {data.summary && <span className="text-muted-foreground text-xs">{data.summary}</span>}
      {loading && <Spinner />}
      {preview !== null && (
        <pre className="bg-background max-h-60 overflow-auto rounded-md p-2 text-xs break-all whitespace-pre-wrap">
          {preview}
        </pre>
      )}
    </div>
  )
}

export { FileCard }
export type { FileCardProps }
