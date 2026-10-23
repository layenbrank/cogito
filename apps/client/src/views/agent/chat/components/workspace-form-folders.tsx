import { Icon } from '@iconify/react/offline'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'

import styles from './workspace-form.module.scss'

interface FolderDraft {
  id: string
  path: string
  isPrimary: boolean
}

interface WorkspaceFormFoldersProps {
  folders: FolderDraft[]
  onAdd: () => void
  onRemove: (id: string) => void
  onPrimary: (id: string) => void
}

function basename(path: string) {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

function WorkspaceFormFolders(props: WorkspaceFormFoldersProps) {
  return (
    <div className={styles.field}>
      <div className="flex items-center justify-between">
        <span className={styles.fieldLabel}>源文件夹</span>
        {props.folders.length > 0 ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0"
            onClick={props.onAdd}>
            <Icon icon="lucide:plus" />
            添加
          </Button>
        ) : null}
      </div>

      {props.folders.length === 0 ? (
        <Button
          type="button"
          variant="ghost"
          className={styles.dropzone}
          onClick={props.onAdd}>
          <Icon
            icon="lucide:folder-plus"
            className="size-7"
          />
          <span>点击添加可读写文件夹</span>
        </Button>
      ) : (
        <ul className={styles.folderList}>
          {props.folders.map(function (folder) {
            return (
              <li
                key={folder.id}
                className={clsx(styles.folderItem, folder.isPrimary && styles.folderPrimary)}>
                <Icon
                  icon="lucide:folder"
                  className={clsx(styles.folderIcon, 'size-4 shrink-0')}
                />
                <div className={styles.folderMeta}>
                  <span className={styles.folderName}>{basename(folder.path)}</span>
                  <span className={styles.folderPath}>{folder.path}</span>
                </div>
                {folder.isPrimary ? (
                  <Badge variant="secondary">主要</Badge>
                ) : (
                  <Button
                    variant="link"
                    size="sm"
                    onClick={function () {
                      props.onPrimary(folder.id)
                    }}>
                    设为主要
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="移除文件夹"
                  onClick={function () {
                    props.onRemove(folder.id)
                  }}>
                  <Icon icon="lucide:x" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export { WorkspaceFormFolders }
export type { FolderDraft, WorkspaceFormFoldersProps }
