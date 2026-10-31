import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Checkbox } from '@cogito/design/components/checkbox'
import { cn } from 'cn'

import styles from '@/views/bookmark/bookmark.module.scss'
import type { ExplorerRow } from '@/views/bookmark/explorer-types'

interface ExplorerGridProps {
  rows: ExplorerRow[]
  selectable: boolean
  isRowChecked: (row: ExplorerRow) => boolean
  canCheckRow: (row: ExplorerRow) => boolean
  onToggleRow: (row: ExplorerRow, on: boolean) => void
  onOpenFolder: (path: string) => void
}

function ExplorerGrid(props: ExplorerGridProps) {
  return (
    <div className={styles.gridWrap}>
      {props.rows.length === 0 ? (
        <p className={styles.gridEmpty}>此文件夹为空</p>
      ) : (
        <div className={styles.grid}>
          {props.rows.map(function (row) {
            const checked = props.isRowChecked(row)
            const canCheck = props.canCheckRow(row)
            return (
              <div
                key={`${row.kind}:${row.id}`}
                className={cn(styles.card, checked && styles.cardSelected)}
                onDoubleClick={function () {
                  if (row.kind === 'folder') props.onOpenFolder(row.path)
                }}>
                {props.selectable && canCheck ? (
                  <div className={styles.cardCheck}>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={function (value) {
                        props.onToggleRow(row, value === true)
                      }}
                    />
                  </div>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  className={styles.cardBody}
                  onClick={function () {
                    if (row.kind === 'folder') props.onOpenFolder(row.path)
                  }}>
                  <span className={styles.cardIcon}>
                    <Icon
                      icon={row.kind === 'folder' ? 'lucide:folder' : 'lucide:globe'}
                      className={cn(
                        'size-7',
                        row.kind === 'folder' ? 'text-amber-500' : 'text-sky-500'
                      )}
                    />
                  </span>
                  <span className={styles.cardTitle}>{row.title}</span>
                  <span className={styles.cardMeta}>
                    {row.kind === 'folder' ? `${row.count} 个链接` : row.url}
                  </span>
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export { ExplorerGrid }
