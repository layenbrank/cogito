import { Button } from '@cogito/design/components/button'
import { Icon } from '@iconify/react/offline'
import { useNavigate } from 'react-router-dom'

import { useTools } from './query.ts'

/**
 * 对话运行时（opencode）没装时的一条提示 + 去下载的入口。
 *
 * 为什么要它：精简版不带运行时，没有这条提示用户就是对着一个「发不出去」的输入框猜。
 * 为什么只认 opencode：pandoc / ffmpeg 是文档转换与指令那两处用到的，到那时各自会报没装，
 * 在这儿一起摆出来只会变成噪音。
 *
 * 挂在会话页顶部（见 `views/agent/chat/chat.tsx`），不是欢迎页的一部分 ——
 * 老会话里没有欢迎页，同样用不了这个运行时。
 */
export function RuntimeNotice() {
  const navigate = useNavigate()
  const tools = useTools()

  const missing = (tools.data ?? []).find(function (row) {
    return row.key === 'opencode' && row.state === 'missing'
  })
  if (!missing) {
    return null
  }

  return (
    <div className="border-border bg-muted/40 mx-3 mb-2 flex shrink-0 items-center justify-between gap-4 rounded-lg border px-3.5 py-2.5">
      <span className="text-muted-foreground text-xs leading-relaxed">
        对话要用到 {missing.label}，它还没安装。
      </span>
      <Button
        type="button"
        size="sm"
        className="shrink-0"
        onClick={function () {
          void navigate('/agent/settings?section=tools')
        }}>
        <Icon icon="lucide:download" />
        去下载
      </Button>
    </div>
  )
}
