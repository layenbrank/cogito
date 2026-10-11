import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { Icon } from '@iconify/react/offline'

type SortKey = 'name' | 'recent'

interface LibraryToolbarProps {
  query: string
  sortKey: SortKey
  onQueryChange: (query: string) => void
  onSortChange: (sortKey: SortKey) => void
  onNew: () => void
  onImport: () => void
}

function LibraryToolbar(props: LibraryToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={props.query}
        onChange={function (event) {
          props.onQueryChange(event.target.value)
        }}
        placeholder="搜索指令…"
        className="max-w-xs bg-background"
      />
      <Select
        items={{ name: '按名称', recent: '最近运行' }}
        value={props.sortKey}
        onValueChange={function (value) {
          if (value === 'name' || value === 'recent') props.onSortChange(value)
        }}>
        <SelectTrigger className="h-8 w-32 bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="name">按名称</SelectItem>
          <SelectItem value="recent">最近运行</SelectItem>
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="secondary"
        onClick={props.onNew}>
        <Icon
          icon="lucide:plus"
          className="size-4"
        />
        新建
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="bg-background"
        onClick={props.onImport}>
        <Icon
          icon="lucide:upload"
          className="size-4"
        />
        导入
      </Button>
    </div>
  )
}

export { LibraryToolbar }
export type { SortKey }
