import { Icon } from '@iconify/react/offline'

import type { MenuItem } from '@/components/contextmenu'
import { type GraphicsProps } from '@/features/capture/components/graphics'

interface CaptureContextMenuActions {
  moveLayer(ids: string[], direction: 'up' | 'down'): void
  group(ids: string[]): void
  ungroup(groupID: string): void
  toggleLock(ids: string[]): void
  copy(ids: string[]): void
  remove(ids: string[]): void
}

interface BuildCaptureContextMenuOptions {
  annotations: GraphicsProps[]
  target: GraphicsProps
  actionIDs: string[]
  actions: CaptureContextMenuActions
}

function menuIcon(name: string) {
  return (
    <Icon
      icon={name}
      width={14}
      height={14}
    />
  )
}

function buildCaptureContextMenuItems(options: BuildCaptureContextMenuOptions): MenuItem[] {
  const { annotations, target, actionIDs, actions } = options
  const annotationById = new Map(
    annotations.map(function (annotation) {
      return [annotation.id, annotation] as const
    })
  )

  const alreadyOneGroup = (function () {
    if (actionIDs.length < 2) return false
    let shared: string | undefined
    for (const id of actionIDs) {
      const item = annotationById.get(id)
      const groupID = item?.groupID
      if (!groupID) return false
      if (shared === undefined) shared = groupID
      else if (shared !== groupID) return false
    }
    return shared !== undefined
  })()

  const canGroup = actionIDs.length >= 2 && !alreadyOneGroup
  const isGrouped = Boolean(target.groupID)
  const hasUnlocked = actionIDs.some(function (id) {
    const item = annotations.find(function (a) {
      return a.id === id
    })
    return item && !item.locked
  })
  const layerIndices = actionIDs
    .map(function (id) {
      return annotations.findIndex(function (a) {
        return a.id === id
      })
    })
    .filter(function (index) {
      return index >= 0
    })
  const canMoveUp =
    layerIndices.length > 0 && Math.max.apply(null, layerIndices) < annotations.length - 1
  const canMoveDown = layerIndices.length > 0 && Math.min.apply(null, layerIndices) > 0

  return [
    {
      key: 'layer-up',
      label: '上移一层',
      icon: menuIcon('mdi:arrange-bring-forward'),
      disabled: !canMoveUp,
      onSelect() {
        actions.moveLayer(actionIDs, 'up')
      }
    },
    {
      key: 'layer-down',
      label: '下移一层',
      icon: menuIcon('mdi:arrange-send-backward'),
      disabled: !canMoveDown,
      onSelect() {
        actions.moveLayer(actionIDs, 'down')
      }
    },
    { type: 'divider' },
    {
      key: 'group',
      label: '群组',
      icon: menuIcon('mdi:group'),
      disabled: !canGroup,
      onSelect() {
        actions.group(actionIDs)
      }
    },
    {
      key: 'ungroup',
      label: '取消群组',
      icon: menuIcon('mdi:ungroup'),
      disabled: !isGrouped,
      onSelect() {
        const groupID = target.groupID
        if (groupID) actions.ungroup(groupID)
      }
    },
    { type: 'divider' },
    {
      key: 'lock',
      label: hasUnlocked ? '锁定' : '解锁',
      icon: menuIcon(hasUnlocked ? 'mdi:lock-outline' : 'mdi:lock-open-variant-outline'),
      onSelect() {
        actions.toggleLock(actionIDs)
      }
    },
    {
      key: 'copy',
      label: '复制',
      icon: menuIcon('mdi:content-copy'),
      onSelect() {
        actions.copy(actionIDs)
      }
    },
    {
      key: 'delete',
      label: '删除',
      danger: true,
      icon: menuIcon('mdi:delete-outline'),
      onSelect() {
        actions.remove(actionIDs)
      }
    }
  ]
}

export type { BuildCaptureContextMenuOptions, CaptureContextMenuActions }
export { buildCaptureContextMenuItems }
