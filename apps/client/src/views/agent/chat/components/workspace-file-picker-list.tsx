import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'

import { findFileIcon, findFolderIcon } from '@/views/workspace/overlay/file-icon.ts'

interface PickerEntry {
  name: string
  kind: string
  relative: string
}

function PickerListShell(props: { children: React.ReactNode; listClassName?: string }) {
  return (
    <div className={clsx('min-h-0 flex-1 overflow-y-auto p-1.5', props.listClassName)}>
      {props.children}
    </div>
  )
}

function PickerList(props: {
  isPending: boolean
  hasWorkspace: boolean
  isSearching: boolean
  entries: readonly PickerEntry[]
  listClassName?: string
  onPick: (relative: string) => void
  onEnterDirectory: (relative: string) => void
}) {
  if (props.isPending) {
    return (
      <PickerListShell listClassName={props.listClassName}>
        <p className="text-muted-foreground flex items-center gap-1.5 p-2.5 text-xs">
          <Icon
            icon="lucide:loader-circle"
            className="size-3.5 animate-spin"
          />
          读取中…
        </p>
      </PickerListShell>
    )
  }

  if (!props.hasWorkspace) {
    return (
      <PickerListShell listClassName={props.listClassName}>
        <p className="text-muted-foreground p-2.5 text-xs">先在左栏添加工作区</p>
      </PickerListShell>
    )
  }

  if (props.entries.length === 0) {
    return (
      <PickerListShell listClassName={props.listClassName}>
        <p className="text-muted-foreground p-2.5 text-xs">
          {props.isSearching ? '没有匹配的文件' : '此目录为空'}
        </p>
      </PickerListShell>
    )
  }

  return (
    <PickerListShell listClassName={props.listClassName}>
      {props.entries.map(function (entry) {
        const isDir = entry.kind === 'dir'
        const fileIcon = isDir ? findFolderIcon(entry.name, false) : findFileIcon(entry.name)
        return (
          <Button
            key={entry.relative}
            type="button"
            variant="ghost"
            className="hover:bg-muted/70 h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-xs font-normal"
            onClick={function () {
              if (isDir) {
                props.onEnterDirectory(entry.relative)
                return
              }
              props.onPick(entry.relative)
            }}>
            <Icon
              icon={fileIcon.icon}
              className={clsx('size-3.5 shrink-0', fileIcon.className)}
            />
            <span className="min-w-0 flex-1 truncate text-start">{entry.name}</span>
            {isDir ? (
              <Icon
                icon="lucide:chevron-right"
                className="text-muted-foreground/60 size-3.5 shrink-0"
              />
            ) : null}
          </Button>
        )
      })}
    </PickerListShell>
  )
}

export { PickerList }
export type { PickerEntry }
