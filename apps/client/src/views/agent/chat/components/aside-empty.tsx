import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { useTerminalStore } from '@/stores/terminal'

interface AsideEmptyProps {
  onOpenFiles: () => void
  onOpenReview: () => void
}

interface AsideCard {
  key: string
  icon: string
  label: string
  hint?: string
  enabled: boolean
  onClick?: () => void
}

/** 空对话右栏：快捷入口；说明走 title，不占第二行 */
function AsideEmpty(props: AsideEmptyProps) {
  const navigate = useNavigate()
  const { primaryPath } = useActiveWorkspace()

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
      icon: 'lucide:folder-tree',
      label: '工作区文件',
      hint: '浏览文件树并预览',
      enabled: true,
      onClick: props.onOpenFiles
    },
    {
      key: 'review',
      icon: 'lucide:git-compare',
      label: '审阅',
      hint: '查看未提交变更并对比',
      enabled: true,
      onClick: props.onOpenReview
    },
    {
      key: 'model',
      icon: 'lucide:box',
      label: '模型设置',
      hint: '配置接入与模型',
      enabled: true,
      onClick: function () {
        void navigate('/agent/settings?section=model')
      }
    },
    {
      key: 'terminal',
      icon: 'lucide:terminal',
      label: '终端',
      hint: '在当前工作区打开 shell',
      enabled: true,
      onClick: handleOpenTerminal
    }
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
      {cards.map(function (card) {
        return (
          <Button
            key={card.key}
            type="button"
            variant="ghost"
            disabled={!card.enabled}
            title={card.hint}
            className="border-border bg-card hover:bg-muted/60 h-auto w-full justify-start gap-3 rounded-xl border px-3 py-2.5 text-left font-normal disabled:opacity-50"
            onClick={function () {
              if (!card.enabled) {
                toast.info('即将推出')
                return
              }
              card.onClick?.()
            }}>
            <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
              <Icon
                icon={card.icon}
                className="size-4"
              />
            </span>
            <span className="text-foreground truncate text-sm font-medium">{card.label}</span>
          </Button>
        )
      })}
    </div>
  )
}

export { AsideEmpty }
