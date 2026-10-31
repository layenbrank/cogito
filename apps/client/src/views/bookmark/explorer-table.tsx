import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Checkbox } from '@cogito/design/components/checkbox'
import { cn } from 'cn'

import styles from '@/views/bookmark/bookmark.module.scss'
import type { ExplorerRow } from '@/views/bookmark/explorer-types'

interface ExplorerTableProps {
  rows: ExplorerRow[]
  selectable: boolean
  isRowChecked: (row: ExplorerRow) => boolean
  canCheckRow: (row: ExplorerRow) => boolean
  onToggleRow: (row: ExplorerRow, on: boolean) => void
  onOpenFolder: (path: string) => void
}

function ExplorerTable(props: ExplorerTableProps) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr>
            {props.selectable ? <th className={cn(styles.th, styles.thCheck)} /> : null}
            <th className={cn(styles.th, styles.thName)}>名称</th>
            <th className={cn(styles.th, styles.thType)}>类型</th>
            <th className={styles.th}>详情</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.length === 0 ? (
            <tr>
              <td
                colSpan={props.selectable ? 4 : 3}
                className={cn(styles.td, 'py-16 text-center text-muted-foreground')}>
                此文件夹为空
              </td>
            </tr>
          ) : (
            props.rows.map(function (row) {
              const checked = props.isRowChecked(row)
              const canCheck = props.canCheckRow(row)
              return (
                <tr
                  key={`${row.kind}:${row.id}`}
                  className={styles.tr}
                  onDoubleClick={function () {
                    if (row.kind === 'folder') props.onOpenFolder(row.path)
                  }}>
                  {props.selectable ? (
                    <td className={styles.td}>
                      {canCheck ? (
                        <Checkbox
                          checked={checked}
                          onCheckedChange={function (value) {
                            props.onToggleRow(row, value === true)
                          }}
                        />
                      ) : (
                        <span className="block size-4" />
                      )}
                    </td>
                  ) : null}
                  <td className={styles.td}>
                    <Button
                      type="button"
                      variant="ghost"
                      className={styles.nameBtn}
                      onClick={function () {
                        if (row.kind === 'folder') props.onOpenFolder(row.path)
                      }}>
                      <Icon
                        icon={row.kind === 'folder' ? 'lucide:folder' : 'lucide:globe'}
                        className={cn(
                          'size-4 shrink-0',
                          row.kind === 'folder' ? 'text-amber-500' : 'text-sky-500'
                        )}
                      />
                      <span className="truncate font-medium">{row.title}</span>
                    </Button>
                  </td>
                  <td className={cn(styles.td, 'text-muted-foreground')}>
                    {row.kind === 'folder' ? '文件夹' : '网址'}
                  </td>
                  <td className={cn(styles.td, 'truncate text-muted-foreground')}>
                    {row.kind === 'folder' ? `${row.count} 个链接` : row.url}
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

export { ExplorerTable }
