import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'

import { findBaseName } from '@/views/agent/chat/components/workspace-relative-path.ts'

function WorkspaceFilePickerToolbar(props: {
  relative: string
  query: string
  canGoUp: boolean
  onQueryChange: (value: string) => void
  onGoUp: () => void
}) {
  return (
    <div className="border-border flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
      {props.canGoUp ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="返回上级目录"
          title="返回上级目录"
          className="size-7 shrink-0"
          onClick={props.onGoUp}>
          <Icon
            icon="lucide:chevron-left"
            className="size-3.5"
          />
        </Button>
      ) : null}
      <Input
        autoFocus
        value={props.query}
        placeholder={props.relative ? `搜索 ${findBaseName(props.relative)}/` : '搜索当前项目文件'}
        aria-label="搜索当前项目文件"
        className="h-7 text-xs"
        onChange={function (event) {
          props.onQueryChange(event.target.value)
        }}
      />
    </div>
  )
}

export { WorkspaceFilePickerToolbar }
