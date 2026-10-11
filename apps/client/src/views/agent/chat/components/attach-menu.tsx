/**
 * Composer + 双栏：工作区浏览/搜索 + 技能列表
 */
import { AttachMenuAside } from './attach-menu-aside.tsx'
import { AttachMenuFilesPane } from './attach-menu-files-pane.tsx'
import { AttachMenuSkillsPane } from './attach-menu-skills-pane.tsx'
import type { AttachCategory, AttachMenuProps, WorkspaceRoot } from './attach-menu-types.ts'
import styles from './attach-menu.module.scss'
import { useAttachMenuBrowse } from './use-attach-menu-browse.ts'

function AttachMenu(props: AttachMenuProps) {
  const browse = useAttachMenuBrowse({
    roots: props.roots,
    category: props.category,
    initialQuery: props.initialQuery,
    onAttach: props.onAttach,
    onPickFile: props.onPickFile
  })

  return (
    <div className={styles.shell}>
      <AttachMenuAside
        category={props.category}
        onCategoryChange={props.onCategoryChange}
        onClearQuery={function () {
          browse.updateQuery('')
        }}
      />
      <div className={styles.main}>
        {props.category === 'files' ? (
          <AttachMenuFilesPane
            searchRef={browse.searchRef}
            query={browse.query}
            onQueryChange={browse.updateQuery}
            loading={browse.loading}
            isSearchMode={browse.isSearchMode}
            showRootPicker={browse.showRootPicker}
            activeRoot={browse.activeRoot}
            relative={browse.relative}
            roots={props.roots}
            hits={browse.hits}
            entries={browse.entries}
            canGoBack={browse.canGoBack}
            onBack={browse.handleBack}
            onEnterRoot={browse.handleEnterRoot}
            onEnterDir={browse.handleEnterDir}
            onAttachPath={browse.handleAttachPath}
          />
        ) : null}

        {props.category === 'skills' ? (
          <AttachMenuSkillsPane
            searchRef={browse.searchRef}
            query={browse.query}
            onQueryChange={browse.updateQuery}
            loading={browse.loading}
            skills={browse.filteredSkills}
            onAttachPath={browse.handleAttachPath}
          />
        ) : null}
      </div>
    </div>
  )
}

export { AttachMenu }
export type { AttachCategory, AttachMenuProps, WorkspaceRoot }
