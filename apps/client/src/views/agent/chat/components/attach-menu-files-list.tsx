import { Icon } from '@iconify/react/offline'
import { Spinner } from '@i-thinking/design/components/spinner'
import { clsx } from 'clsx'

import { findEntryIcon, findFileIcon, findFolderIcon } from '@/features/agent/model/file-icon'
import type { DirEntry, SearchHit } from '@/lib/workspace-files'

import styles from './attach-menu.module.scss'
import type { WorkspaceRoot } from './attach-menu-types.ts'

interface AttachMenuFilesListProps {
  loading: boolean
  showRootPicker: boolean
  isSearchMode: boolean
  activeRoot: WorkspaceRoot | null
  roots: WorkspaceRoot[]
  hits: SearchHit[]
  entries: DirEntry[]
  onEnterRoot: (root: WorkspaceRoot) => void
  onEnterDir: (entry: DirEntry) => void
  onAttachPath: (path: string, name: string, relativePath?: string) => void
}

function AttachMenuFilesList(props: AttachMenuFilesListProps) {
  if (props.loading) {
    return (
      <div className={styles.loading}>
        <Spinner />
      </div>
    )
  }

  if (props.showRootPicker) {
    return (
      <>
        {props.roots.map(function (root) {
          return (
            <button
              key={root.id}
              type="button"
              className={styles.row}
              onClick={function () {
                props.onEnterRoot(root)
              }}>
              <span className={clsx(styles.rowIconBadge, styles.rowIconBadgeDir)}>
                <Icon
                  icon={findFolderIcon()}
                  width={16}
                  height={16}
                />
              </span>
              <span className={styles.rowTitle}>{root.label}</span>
              <Icon
                icon="mdi:chevron-right"
                width={16}
                height={16}
                className={styles.rowChevron}
              />
            </button>
          )
        })}
      </>
    )
  }

  if (props.isSearchMode) {
    if (props.hits.length === 0) {
      return <p className={styles.empty}>无匹配文件</p>
    }
    return (
      <>
        {props.hits.map(function (hit) {
          return (
            <button
              key={hit.path}
              type="button"
              className={styles.row}
              onClick={function () {
                props.onAttachPath(hit.path, hit.name, hit.relative)
              }}>
              <span className={styles.rowIconBadge}>
                <Icon
                  icon={findFileIcon(hit.name)}
                  width={16}
                  height={16}
                />
              </span>
              <span className={styles.rowBody}>
                <span className={styles.rowTitle}>{hit.name}</span>
                <span className={styles.rowMetaPath}>{hit.relative}</span>
              </span>
              <span className={styles.rowAdd}>
                <Icon
                  icon="mdi:plus"
                  width={14}
                  height={14}
                />
              </span>
            </button>
          )
        })}
      </>
    )
  }

  if (!props.activeRoot) {
    return <p className={styles.empty}>请先配置工作区</p>
  }
  if (props.entries.length === 0) {
    return <p className={styles.empty}>空目录</p>
  }

  return (
    <>
      {props.entries.map(function (entry) {
        const isDir = entry.kind === 'dir'
        return (
          <button
            key={entry.path}
            type="button"
            className={styles.row}
            onClick={function () {
              if (isDir) {
                props.onEnterDir(entry)
                return
              }
              props.onAttachPath(entry.path, entry.name, entry.relative)
            }}>
            {isDir ? (
              <Icon
                icon="mdi:chevron-right"
                width={14}
                height={14}
                className={styles.rowChevron}
              />
            ) : (
              <span className={styles.rowChevronSpacer} />
            )}
            <span className={clsx(styles.rowIconBadge, isDir && styles.rowIconBadgeDir)}>
              <Icon
                icon={findEntryIcon(entry.name, entry.kind)}
                width={16}
                height={16}
              />
            </span>
            <span className={styles.rowTitle}>{entry.name}</span>
            {!isDir ? (
              <span className={styles.rowAdd}>
                <Icon
                  icon="mdi:plus"
                  width={14}
                  height={14}
                />
              </span>
            ) : null}
          </button>
        )
      })}
    </>
  )
}

export { AttachMenuFilesList }
