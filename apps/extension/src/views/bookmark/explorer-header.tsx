import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { cn } from 'cn'

import styles from '@/views/bookmark/bookmark.module.scss'
import {
  SORT_OPTIONS,
  type BookmarkSortKey,
  type BookmarkViewMode
} from '@/views/bookmark/view-prefs'

interface ExplorerHeaderProps {
  cwd: string
  crumbs: string[]
  query: string
  viewMode: BookmarkViewMode
  sortKey: BookmarkSortKey
  onGoCrumb: (index: number) => void
  onGoUp: () => void
  onGoRoot: () => void
  onUpdateQuery: (query: string) => void
  onUpdateViewMode: (mode: BookmarkViewMode) => void
  onUpdateSortKey: (key: BookmarkSortKey) => void
}

function ExplorerHeader(props: ExplorerHeaderProps) {
  return (
    <header className={styles.commandBar}>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="返回上一级"
          className="size-7 rounded-md"
          disabled={!props.cwd}
          onClick={props.onGoUp}>
          <Icon icon="lucide:arrow-left" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="回到根目录"
          title="回到根目录"
          className="size-7 rounded-md"
          onClick={props.onGoRoot}>
          <Icon icon="lucide:refresh-cw" />
        </Button>
      </div>

      <div className={styles.crumb}>
        <Icon
          icon="lucide:folder"
          className="size-3.5 shrink-0 text-amber-500"
        />
        <Button
          type="button"
          variant="ghost"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={function () {
            props.onGoCrumb(-1)
          }}>
          书签
        </Button>
        {props.crumbs.map(function (segment, index) {
          const crumbPath = props.crumbs.slice(0, index + 1).join('/')
          return (
            <span
              key={crumbPath}
              className="flex min-w-0 items-center gap-1">
              <Icon
                icon="lucide:chevron-right"
                className="size-3.5 shrink-0 text-muted-foreground/70"
              />
              <Button
                type="button"
                variant="ghost"
                className={cn(
                  'truncate',
                  index === props.crumbs.length - 1
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={function () {
                  props.onGoCrumb(index)
                }}>
                {segment}
              </Button>
            </span>
          )
        })}
      </div>

      <div className={styles.viewTools}>
        <Select
          items={[...SORT_OPTIONS]}
          value={props.sortKey}
          onValueChange={function (value) {
            if (
              value === 'type' ||
              value === 'name-asc' ||
              value === 'name-desc' ||
              value === 'links' ||
              value === 'index'
            ) {
              props.onUpdateSortKey(value)
            }
          }}>
          <SelectTrigger
            className={styles.sortControl}
            aria-label="排序方式">
            <SelectValue placeholder="排序" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map(function (item) {
              return (
                <SelectItem
                  key={item.value}
                  value={item.value}>
                  {item.label}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>

        <ToggleGroup
          spacing={0}
          value={[props.viewMode]}
          onValueChange={function (value) {
            const next = value[0]
            if (next === 'list' || next === 'grid') props.onUpdateViewMode(next)
          }}
          className={styles.viewToggle}>
          <ToggleGroupItem
            value="list"
            aria-label="列表视图"
            className={styles.viewToggleItem}>
            <Icon icon="lucide:list" />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="grid"
            aria-label="网格视图"
            className={styles.viewToggleItem}>
            <Icon icon="lucide:layout-grid" />
          </ToggleGroupItem>
        </ToggleGroup>

        <div className={styles.search}>
          <Icon
            icon="lucide:search"
            className={styles.searchIcon}
          />
          <Input
            value={props.query}
            placeholder="搜索"
            aria-label="搜索当前文件夹"
            className={styles.searchInput}
            onChange={function (event) {
              props.onUpdateQuery(event.target.value)
            }}
          />
        </div>
      </div>
    </header>
  )
}

export { ExplorerHeader }
