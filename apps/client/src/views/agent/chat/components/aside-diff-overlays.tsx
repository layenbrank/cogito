import { Icon } from '@iconify/react/offline'

import type { DiffMeta } from '@/lib/workspace-git'

function AsideDiffOverlays(props: {
  isPending: boolean
  error: string | null
  meta: DiffMeta | null
}) {
  if (props.isPending) {
    return (
      <p className="bg-background text-muted-foreground absolute inset-0 flex items-center gap-1.5 p-3 text-xs">
        <Icon
          icon="lucide:loader-circle"
          className="size-3.5 animate-spin"
        />
        读取差异…
      </p>
    )
  }
  if (props.error) {
    return <p className="bg-background text-destructive absolute inset-0 p-3 text-xs">{props.error}</p>
  }
  if (props.meta?.isBinary) {
    return (
      <p className="bg-background text-muted-foreground absolute inset-0 flex items-center justify-center p-3 text-xs">
        这是二进制文件，无法对比内容
      </p>
    )
  }
  if (props.meta?.isIdentical) {
    return (
      <p className="bg-background text-muted-foreground absolute inset-0 flex items-center justify-center p-3 text-xs">
        归一换行后内容相同
      </p>
    )
  }
  return null
}

export { AsideDiffOverlays }
