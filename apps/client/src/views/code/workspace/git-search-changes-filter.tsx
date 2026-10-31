import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'

interface GitSearchChangesFilterProps {
  fileFilter: string
  onFileFilterChange: (value: string) => void
}

function GitSearchChangesFilter(props: GitSearchChangesFilterProps) {
  return (
    <div className="border-border/40 relative flex shrink-0 items-center gap-1.5 border-b px-2.5 py-2">
      <Icon
        icon="lucide:filter"
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2"
      />
      <Input
        value={props.fileFilter}
        placeholder="筛选文件…"
        aria-label="筛选变更文件"
        className="bg-muted/30 border-border/50 h-9 pl-9 text-sm shadow-none"
        onChange={function (event) {
          props.onFileFilterChange(event.target.value)
        }}
      />
      {props.fileFilter ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="清除筛选"
          className="text-muted-foreground size-7 shrink-0"
          onClick={function () {
            props.onFileFilterChange('')
          }}>
          <Icon
            icon="lucide:x"
            className="size-3.5"
          />
        </Button>
      ) : null}
    </div>
  )
}

export { GitSearchChangesFilter }
