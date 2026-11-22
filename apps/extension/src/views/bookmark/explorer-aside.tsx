import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'

import styles from '@/views/bookmark/bookmark.module.scss'
import type { BookmarkNode } from '@/views/bookmark/import/types'

interface ExplorerAsideProps {
  cwd: string
  sidebarRoots: BookmarkNode[]
  onGoRoot: () => void
  onOpenFolder: (path: string) => void
}

function ExplorerAside(props: ExplorerAsideProps) {
  return (
    <aside className={styles.aside}>
      <p className={styles.asideTitle}>位置</p>
      <nav className={styles.asideNav}>
        <Button
          type="button"
          variant="ghost"
          className={cn(styles.asideItem, !props.cwd && styles.asideItemActive)}
          onClick={props.onGoRoot}>
          <Icon
            icon="lucide:house"
            className="size-4 shrink-0"
          />
          <span className="truncate">全部</span>
        </Button>
        {props.sidebarRoots.map(function (root) {
          const path = root.title
          const active = props.cwd === path || props.cwd.startsWith(`${path}/`)
          return (
            <Button
              key={root.id}
              type="button"
              variant="ghost"
              className={cn(styles.asideItem, active && styles.asideItemActive)}
              onClick={function () {
                props.onOpenFolder(path)
              }}>
              <Icon
                icon="lucide:folder"
                className="size-4 shrink-0 text-amber-500"
              />
              <span className="truncate">{root.title}</span>
            </Button>
          )
        })}
      </nav>
    </aside>
  )
}

export { ExplorerAside }
