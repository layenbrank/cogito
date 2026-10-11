import { Icon } from '@iconify/react/offline'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'

import styles from './composer.module.scss'

interface ComposerStatusBarProps {
  workspaceTitle: string | null
  showGit: boolean
  branch: string | null
  branchLoading: boolean
  branchOpen: boolean
  onBranchOpenChange: (open: boolean) => void
  branchItems: Array<{ key: string; label: string; current: boolean }>
  onCheckout: (branch: string) => void
}

function ComposerStatusBar(props: ComposerStatusBarProps) {
  if (!props.workspaceTitle) {
    return (
      <div
        className={styles.status}
        aria-hidden
      />
    )
  }

  return (
    <div className={`${styles.status} flex items-center justify-start`}>
      {props.showGit ? (
        <DropdownMenu
          open={props.branchOpen}
          onOpenChange={props.onBranchOpenChange}>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className={styles.branchBtn}
                disabled={props.branchLoading}
                aria-label="切换分支"
              />
            }>
            <Icon
              icon="mdi:source-branch"
              width={12}
              height={12}
            />
            <span className={styles.statusText}>{props.branch}</span>
            <Icon
              icon="mdi:chevron-down"
              width={12}
              height={12}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-52">
            {props.branchItems.map(function (item) {
              return (
                <DropdownMenuItem
                  key={item.key}
                  onClick={function () {
                    props.onCheckout(item.key)
                  }}>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.current ? (
                    <Icon
                      icon="mdi:check"
                      width={14}
                      height={14}
                    />
                  ) : null}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <span className={styles.statusItem}>
        <Icon
          icon="mdi:folder-outline"
          width={12}
          height={12}
        />
        <span className={`${styles.statusText} truncate`}>{props.workspaceTitle}</span>
      </span>
      <span className={styles.statusItem}>
        <Icon
          icon="mdi:monitor"
          width={12}
          height={12}
        />
        <span className={styles.statusText}>本地</span>
      </span>
    </div>
  )
}

export { ComposerStatusBar }
