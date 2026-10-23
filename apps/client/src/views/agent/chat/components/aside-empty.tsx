import { Icon } from '@iconify/react/offline'
import { useAui } from '@assistant-ui/react'
import { Button } from '@cogito/design/components/button'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { attachWorkspacePaths } from '@/features/agent/attachment.ts'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { useTerminalStore } from '@/stores/terminal'

interface AsideCard {
  key: string
  icon: string
  label: string
  hint?: string
  enabled: boolean
  onClick?: () => void
}

/** 空对话右栏：Qoder 式快捷卡骨架 */
function AsideEmpty() {
  const aui = useAui()
  const navigate = useNavigate()
  const { primaryPath } = useActiveWorkspace()

  function handleOpenWorkspaceFile() {
    void dialogOpen({ multiple: true })
      .then(function (paths) {
        const list = Array.isArray(paths) ? paths : paths ? [paths] : null
        return attachWorkspacePaths(aui, list, primaryPath)
      })
      .then(function (result) {
        if (result.isMissingWorkspace) {
          toast.error('先在左栏添加一个工作区')
          return
        }
        if (result.attached > 0) toast.success(`已引用 ${result.attached} 项`)
        if (result.skipped.length > 0) {
          toast.warning(`${result.skipped.join('、')} 不在当前工作区内，已跳过`)
        }
      })
      .catch(function (error: unknown) {
        toast.error(error instanceof Error ? error.message : '选择文件失败')
      })
  }

  function handleOpenTerminal() {
    if (!primaryPath) {
      toast.error('先在左栏添加一个工作区')
      return
    }
    useTerminalStore.getState().newTab(primaryPath)
  }

  const cards: AsideCard[] = [
    {
      key: 'files',
      icon: 'lucide:folder',
      label: '打开工作区文件',
      hint: '引用到输入框',
      enabled: true,
      onClick: handleOpenWorkspaceFile
    },
    {
      key: 'model',
      icon: 'lucide:box',
      label: '打开模型设置',
      hint: '配置接入与模型',
      enabled: true,
      onClick: function () {
        void navigate('/agent/settings?section=model')
      }
    },
    {
      key: 'review',
      icon: 'lucide:square-plus',
      label: '打开审阅',
      hint: '即将推出',
      enabled: false
    },
    {
      key: 'terminal',
      icon: 'lucide:terminal',
      label: '打开终端',
      hint: '在当前工作区打开 shell',
      enabled: true,
      onClick: handleOpenTerminal
    }
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
      {cards.map(function (card) {
        return (
          <Button
            key={card.key}
            type="button"
            variant="ghost"
            disabled={!card.enabled}
            className="border-border bg-card hover:bg-muted/60 h-auto w-full justify-start gap-3 rounded-xl border px-3 py-3 text-left font-normal disabled:opacity-50"
            onClick={function () {
              if (!card.enabled) {
                toast.info('即将推出')
                return
              }
              card.onClick?.()
            }}>
            <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
              <Icon
                icon={card.icon}
                className="size-4"
              />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-foreground text-sm font-medium">{card.label}</span>
              {card.hint ? (
                <span className="text-muted-foreground truncate text-xs">{card.hint}</span>
              ) : null}
            </span>
          </Button>
        )
      })}
    </div>
  )
}

export { AsideEmpty }
