import { Icon } from '@iconify/react/offline'

import type { MenuItem } from '@/components/contextmenu'
import { POST_OVERLAY_TILE, DELETE_OVERLAY_TILE } from '@/apis/capture'

import { LayoutPicker } from './picker'
import type { Tile } from './types'

interface TileMenuContext {
  /** 触发右键的那块磁贴 */
  tile: Tile
  /** 参与操作的全部磁贴（触发项一定包含在内） */
  targets: Tile[]
  /** 可移入的集合（墙上所有 `component === 'collection'`） */
  collections: Tile[]
  /** 新建集合：`ids` 非空时表示「建完把这几种移进去」（右键的是磁贴） */
  onCreateCollection: (ids: string[] | null) => void
  onMoveToCollection: (collectionID: string, ids: string[]) => void
  onLeaveCollection: (ids: string[]) => void
  onDelete: (ids: string[]) => void
}

interface WallMenuContext {
  onCreateCollection: (ids: string[] | null) => void
  onOpenBookmarks: () => void
}

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
          void POST_OVERLAY_TILE(tile.component, tile.id, {
            size: tile.size,
            shape: tile.shape,
            direction: tile.direction,
            round: tile.round,
            background: tile.background,
            title: tile.title,
            mark: tile.mark,
            url: tile.url
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
          void DELETE_OVERLAY_TILE(tile.id)
        }
      }
    ]
  }
}

/**
 * 集合层级只有一层：**集合里只能放网址，集合本身不能再进集合**（产品口径 2026-11-17）。
 *
 * 以前只挡「会成环」的移动，于是集合仍可拖进另一个集合。嵌套没有对应的浏览 UI（集合页只画成员，
 * 不再进子集合），用户看到的是一层里少了一半东西 —— 所以从入口处就不允许。
 */
function isCollectionTile(item: Tile): boolean {
  return item.component === 'collection'
}

/** `id` 自己 + 全部祖先（库里可能已有历史嵌套数据，别把自己收进来） */
function findSelfAndAncestors(id: string, collections: Tile[]): Set<string> {
  const byId = new Map(
    collections.map(function (item) {
      return [item.id, item] as const
    })
  )
  const out = new Set<string>([id])
  let cursor = byId.get(id)?.collectionID ?? null
  while (cursor) {
    // 库里已有脏环时别陷进死循环
    if (out.has(cursor)) break
    out.add(cursor)
    cursor = byId.get(cursor)?.collectionID ?? null
  }
  return out
}

function buildItems(context: TileMenuContext): MenuItem[] {
  const { tile, targets } = context
  const items: MenuItem[] = []
  const isCollection = tile.component === 'collection'
  const movable = targets.filter(function (item) {
    return item.id && item.id !== tile.id
  })
  /** 能作为集合成员的只有网址（集合不能套集合） */
  const joinable = targets.filter(function (item) {
    return item.id && !isCollectionTile(item)
  })
  const joinableIDs = joinable.map(function (item) {
    return item.id
  })

  if (isCollection) {
    // 右键落在集合上：把选中的网址收进这个集合（集合项直接不算进「所选」）
    const ancestors = findSelfAndAncestors(tile.id, context.collections)
    const joined = movable.filter(function (item) {
      return !isCollectionTile(item) && !ancestors.has(item.id)
    })
    items.push({
      key: 'join-current',
      label: `将所选 ${joined.length} 项加入此集合`,
      icon: (
        <Icon
          icon="lucide:folder-input"
          width={14}
          height={14}
        />
      ),
      disabled: joined.length === 0,
      onSelect() {
        context.onMoveToCollection(
          tile.id,
          joined.map(function (item) {
            return item.id
          })
        )
      }
    })
  } else {
    items.push({
      key: 'join',
      label: '加入集合',
      icon: (
        <Icon
          icon="lucide:folder-plus"
          width={14}
          height={14}
        />
      ),
      // 选中项里没有网址（全是集合）时没有任何合法目标
      disabled: joinableIDs.length === 0,
      children: [
        ...context.collections.map(function (collection) {
          return {
            key: `join-${collection.id}`,
            label: collection.title,
            icon: (
              <Icon
                icon="lucide:folder"
                width={14}
                height={14}
              />
            ),
            onSelect() {
              context.onMoveToCollection(collection.id, joinableIDs)
            }
          }
        }),
        ...(context.collections.length > 0
          ? [{ key: 'join-divider', type: 'divider' as const }]
          : []),
        {
          key: 'join-new',
          label: '新建集合…',
          icon: (
            <Icon
              icon="lucide:folder-plus"
              width={14}
              height={14}
            />
          ),
          // 从「加入集合」进的新建，语义是「建好顺手移进去」，不能建完就丢下选中项
          onSelect() {
            context.onCreateCollection(joinableIDs)
          }
        }
      ]
    })
  }

  if (
    targets.some(function (item) {
      return Boolean(item.collectionID)
    })
  ) {
    items.push({
      key: 'leave',
      label: '移出集合',
      icon: (
        <Icon
          icon="lucide:folder-minus"
          width={14}
          height={14}
        />
      ),
      onSelect() {
        context.onLeaveCollection(targets.map((item) => item.id))
      }
    })
  }

  items.push(buildLayout(tile))
  items.push(buildFloat(tile))

  // 删除从磁贴角上的垃圾桶挪到菜单里：多选后一次性处理，也不挡视觉
  items.push({ key: 'delete-divider', type: 'divider' })
  items.push({
    key: 'delete',
    label: '删除',
    danger: true,
    icon: (
      <Icon
        icon="lucide:trash-2"
        width={14}
        height={14}
      />
    ),
    children: [
      {
        key: 'delete-selected',
        label: `删除所选 ${targets.length} 项`,
        danger: true,
        onSelect() {
          context.onDelete(targets.map((item) => item.id))
        }
      },
      {
        key: 'delete-only-collection',
        label: '仅删除集合（保留其中的网址）',
        disabled: !isCollection,
        onSelect() {
          context.onDelete([tile.id])
        }
      }
    ]
  })

  return items
}

/** 墙面空白处的菜单：新建集合 / 去书签库加网址 */
function buildWallItems(context: WallMenuContext): MenuItem[] {
  return [
    {
      key: 'new-collection',
      label: '新建集合',
      icon: (
        <Icon
          icon="lucide:folder-plus"
          width={14}
          height={14}
        />
      ),
      // 空白处新建：没有要顺带移入的东西
      onSelect() {
        context.onCreateCollection(null)
      }
    },
    {
      key: 'open-bookmark',
      label: '打开书签库',
      icon: (
        <Icon
          icon="lucide:bookmark"
          width={14}
          height={14}
        />
      ),
      onSelect: context.onOpenBookmarks
    }
  ]
}

export { buildItems, buildWallItems }
export type { TileMenuContext, WallMenuContext }
