import { Button } from '@cogito/design/components/button'
import { Icon } from '@iconify/react/offline'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  useInstallTool,
  useRemoveTool,
  useToolProgress,
  useTools,
  type ToolKey,
  type ToolRow
} from '@/features/tool/query.ts'
import { toIpcMessage } from '@/utils/ipc.errors.ts'
import { SettingsSection } from '@/views/agent/settings/components/section.tsx'

/**
 * 工具：对话与文档转换要用到的运行时。
 *
 * 精简版不带 pandoc / ffmpeg / opencode（加起来 800 多 MB），第一次要用时才在这里下载；
 * 完整版内置，状态显示「随包内置」，不需要动。装过的那份优先于内置的那份。
 */

/** 状态 → 界面文案；四档由契约给定，缺一档就编译不过 */
const STATE_LABELS: Record<ToolRow['state'], string> = {
  installed: '已下载',
  bundled: '随包内置',
  missing: '未安装',
  unsupported: '当前平台无下载源'
}

/** 体积文案：1 位小数只在 GB 档才有意义，MB 档取整就够了 */
function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return ''
  }
  const mb = bytes / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

function ToolRowView(props: {
  tool: ToolRow
  /** 正在下载的那个工具的键；同时只允许一个 */
  downloadingKey: ToolKey | null
  onInstall: (key: ToolKey) => void
  onRemove: (key: ToolKey) => void
}) {
  const tool = props.tool
  const isBusy = props.downloadingKey !== null
  const detail = [
    STATE_LABELS[tool.state],
    tool.version ? `v${tool.version}` : '',
    formatBytes(tool.bytes)
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm">{tool.label}</span>
        <span className="text-muted-foreground text-xs leading-relaxed">{tool.summary}</span>
        <span className="text-muted-foreground text-xs">{detail}</span>
      </div>

      <div className="shrink-0">
        {tool.state === 'missing' ? (
          <Button
            type="button"
            size="sm"
            disabled={isBusy}
            onClick={function () {
              props.onInstall(tool.key)
            }}>
            <Icon icon="lucide:download" />
            下载
          </Button>
        ) : null}

        {tool.state === 'installed' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={function () {
              props.onRemove(tool.key)
            }}>
            删除
          </Button>
        ) : null}

        {tool.state === 'bundled' ? (
          <span className="text-muted-foreground text-xs">无需下载</span>
        ) : null}

        {tool.state === 'unsupported' ? (
          <span className="text-muted-foreground text-xs">—</span>
        ) : null}
      </div>
    </div>
  )
}

export function ToolsSection() {
  const tools = useTools()
  const progress = useToolProgress()
  const install = useInstallTool()
  const remove = useRemoveTool()
  /** 谁在下载：主进程按工具串行，界面上也只让一个按钮转起来 */
  const [downloadingKey, updateDownloadingKey] = useState<ToolKey | null>(null)

  function startInstall(key: ToolKey) {
    updateDownloadingKey(key)
    install.mutate(key, {
      onSuccess: function () {
        updateDownloadingKey(null)
        toast.success('已下载完成')
      },
      onError: function (error) {
        updateDownloadingKey(null)
        toast.error(toIpcMessage(error, '下载失败'))
      }
    })
  }

  function startRemove(key: ToolKey) {
    remove.mutate(key, {
      onSuccess: function () {
        toast.success('已删除')
      },
      onError: function (error) {
        toast.error(toIpcMessage(error, '删除失败'))
      }
    })
  }

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="工具"
        hint="对话与文档转换要用到的运行时。精简版不随包发出，在这里按需下载；已经装过的优先于内置的那份。">
        {(tools.data ?? []).map(function (tool) {
          return (
            <ToolRowView
              key={tool.key}
              tool={tool}
              downloadingKey={downloadingKey}
              onInstall={startInstall}
              onRemove={startRemove}
            />
          )
        })}

        {downloadingKey !== null ? (
          <div className="flex items-center justify-between gap-6 py-2.5">
            <span className="text-muted-foreground text-xs">
              正在下载…{percent === null ? '' : ` ${percent}%`}
            </span>
            <span className="text-muted-foreground text-xs">
              下载完会自动解压到本地，无需其他操作
            </span>
          </div>
        ) : null}

        {tools.isLoading ? (
          <span className="text-muted-foreground py-2.5 text-xs">读取中…</span>
        ) : null}

        {tools.isError ? (
          <span className="text-destructive py-2.5 text-xs">
            {toIpcMessage(tools.error, '读取工具状态失败')}
          </span>
        ) : null}
      </SettingsSection>
    </div>
  )
}
