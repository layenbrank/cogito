import { Badge } from '@i-thinking/design/components/badge'
import { Icon } from '@iconify/react/offline'

import type { Caps } from '@/views/directive/run/run-caps'

interface ToolbarTitleProps {
  name: string
  description?: string
  bucket?: string | null
  folder?: string | null
  stepCount: number
  inputCount: number
  caps: Caps
  isDirty: boolean
}

function ToolbarTitle(props: ToolbarTitleProps) {
  const title = props.description?.trim() || undefined

  return (
    <div className="min-w-0 px-1">
      <div className="flex min-w-0 items-center gap-2">
        <h1
          title={title}
          className="truncate text-sm font-semibold">
          {props.name || '未命名指令'}
        </h1>
        {props.isDirty ? (
          <Badge
            variant="outline"
            className="shrink-0 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
            未保存
          </Badge>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">已同步</span>
        )}
      </div>
      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {props.stepCount} 步 · {props.inputCount} 输入
        </span>
        {props.bucket ? (
          <Badge
            variant="outline"
            className="h-5 px-1.5 py-0 font-normal">
            {props.bucket}
          </Badge>
        ) : null}
        {props.folder ? (
          <Badge
            variant="secondary"
            className="h-5 px-1.5 py-0 font-normal">
            {props.folder}
          </Badge>
        ) : null}
        {props.caps.hasCron ? (
          <Badge
            variant="outline"
            className="h-5 gap-1 px-1.5 py-0 font-normal text-primary">
            <Icon
              icon="mdi:clock-outline"
              className="size-3"
            />
            cron
          </Badge>
        ) : null}
        {props.caps.hasWatch ? (
          <Badge
            variant="outline"
            className="h-5 gap-1 px-1.5 py-0 font-normal text-primary">
            <Icon
              icon="mdi:eye-outline"
              className="size-3"
            />
            watch
          </Badge>
        ) : null}
      </div>
    </div>
  )
}

export { ToolbarTitle }
