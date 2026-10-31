/**
 * 侧栏里的镜像入口：切换当前工作台镜像。
 * 镜像决定磁贴和网址集合，不放进地址栏。
 *
 * 新建 / 改名 / 改描述 / 删除等管理操作收进「管理镜像」Dialog（`mirror-manage.tsx`），
 * 下拉只负责快速切换，避免把管理面塞进标题栏 Popover。
 */
import { MirrorManageDialog } from '@/views/overview/caption/mirror-manage'
import { MirrorSwitcherCreate } from '@/views/overview/caption/mirror-switcher-create.tsx'
import { MirrorSwitcherOpen } from '@/views/overview/caption/mirror-switcher-open.tsx'
import { useMirrorSwitcherState } from '@/views/overview/caption/use-mirror-switcher-state.ts'

interface MirrorSwitcherProps {
  /** 侧栏收起时只留图标 */
  isCompact?: boolean
  /** 底栏向上展开，避免菜单伸出窗口 */
  menuSide?: 'top' | 'bottom'
}

function MirrorSwitcher(props: MirrorSwitcherProps) {
  const state = useMirrorSwitcherState()

  if (!state.active) {
    return (
      <MirrorSwitcherCreate
        isCompact={props.isCompact}
        isBusy={state.isBusy}
        isManageOpen={state.isManageOpen}
        onCreate={function () {
          void state.handleCreate()
        }}
        onManageOpenChange={state.updateManageOpen}
      />
    )
  }

  return (
    <>
      <MirrorSwitcherOpen
        active={state.active}
        isCompact={props.isCompact}
        menuSide={props.menuSide}
        isBusy={state.isBusy}
        isOpen={state.isOpen}
        sorted={state.sorted}
        activeID={state.activeID}
        cursor={state.cursor}
        onOpenChange={state.handleOpenChange}
        onCursor={state.updateCursor}
        onSwitch={function (id) {
          void state.switchTo(id)
        }}
        onKeyDown={state.onKeyDown}
        onCreate={function () {
          void state.handleCreate()
        }}
        onOpenManage={function () {
          state.updateOpen(false)
          state.updateManageOpen(true)
        }}
      />

      <MirrorManageDialog
        open={state.isManageOpen}
        onOpenChange={state.updateManageOpen}
      />
    </>
  )
}

export { MirrorSwitcher }
