import { Icon } from '@iconify/react/offline'
import { Input } from '@i-thinking/design/components/input'
import type { RefObject } from 'react'

import type { DirEntry, SearchHit } from '@/lib/workspace-files'

import { AttachMenuFilesList } from './attach-menu-files-list.tsx'
import styles from './attach-menu.module.scss'
import type { WorkspaceRoot } from './attach-menu-types.ts'

interface AttachMenuFilesPaneProps {
  searchRef: RefObject<HTMLInputElement | null>
  query: string
  onQueryChange: (query: string) => void
  loading: boolean
  isSearchMode: boolean
  showRootPicker: boolean
  activeRoot: WorkspaceRoot | null
  relative: string
  roots: WorkspaceRoot[]
  hits: SearchHit[]
  entries: DirEntry[]
  canGoBack: boolean
  onBack: () => void
  onEnterRoot: (root: WorkspaceRoot) => void
  onEnterDir: (entry: DirEntry) => void
  onAttachPath: (path: string, name: string, relativePath?: string) => void
}

function AttachMenuFilesPane(props: AttachMenuFilesPaneProps) {
  return (
    <>
      <div className={styles.searchWrap}>
        <div className={styles.searchField}>
          <Icon
            icon="mdi:magnify"
            className={styles.searchIcon}
            width={15}
            height={15}
          />
          <Input
            ref={props.searchRef}
            placeholder="搜索文件"
            className={styles.searchInput}
            value={props.query}
            onChange={function (event) {
              props.onQueryChange(event.target.value)
            }}
          />
        </div>
      </div>
      {props.canGoBack ? (
        <button
          type="button"
          className={styles.back}
          onClick={props.onBack}>
          <Icon
            icon="mdi:arrow-left"
            width={14}
            height={14}
          />
          <span>{props.relative ? '返回上级目录' : '返回工作区列表'}</span>
        </button>
      ) : null}
      <div className={styles.list}>
        <AttachMenuFilesList
          loading={props.loading}
          showRootPicker={props.showRootPicker}
          isSearchMode={props.isSearchMode}
          activeRoot={props.activeRoot}
          roots={props.roots}
          hits={props.hits}
          entries={props.entries}
          onEnterRoot={props.onEnterRoot}
          onEnterDir={props.onEnterDir}
          onAttachPath={props.onAttachPath}
        />
      </div>
    </>
  )
}

export { AttachMenuFilesPane }
