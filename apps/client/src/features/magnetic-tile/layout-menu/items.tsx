import { Icon } from '@iconify/react/offline'

import type { MenuItem } from '@/components/contextmenu'
import { mountOverlayTile, removeOverlayTile } from '@/features/capture/tauri'

import { LayoutPicker } from './picker'
import type { Tile } from './types'

function layoutPickerKey(tile: Tile) {
  return `${tile.size}-${tile.shape}-${tile.direction}`
}

function buildLayout(tile: Tile): MenuItem {
  return {
    key: 'layout',
    label: '布局',
    icon: (
      <Icon
        icon="ant-design:appstore-outlined"
        width={14}
        height={14}
      />
    ),
    content: (
      <LayoutPicker
        key={layoutPickerKey(tile)}
        tile={tile}
      />
    )
  }
}

function buildFloat(tile: Tile): MenuItem {
  const hasTile = Boolean(tile.id)

  return {
    key: 'float',
    label: '浮层',
    icon: (
      <Icon
        icon="ant-design:block-outlined"
        width={14}
        height={14}
      />
    ),
    children: [
      {
        key: 'float-mount',
        label: '添加',
        icon: (
          <Icon
            icon="ant-design:plus-outlined"
            width={14}
            height={14}
          />
        ),
        disabled: !hasTile,
        onSelect() {
          if (!tile.id) return
          void mountOverlayTile(tile.component, tile.id, {
            size: tile.size,
            shape: tile.shape,
            direction: tile.direction,
            round: tile.round,
            background: tile.background,
            title: tile.title,
            mark: tile.mark
          })
        }
      },
      {
        key: 'float-unmount',
        label: '移除',
        icon: (
          <Icon
            icon="ant-design:minus-outlined"
            width={14}
            height={14}
          />
        ),
        disabled: !hasTile,
        onSelect() {
          if (!tile.id) return
          void removeOverlayTile(tile.id)
        }
      }
    ]
  }
}

function buildItems(tile: Tile): MenuItem[] {
  return [buildLayout(tile), buildFloat(tile)]
}

export { buildItems }
