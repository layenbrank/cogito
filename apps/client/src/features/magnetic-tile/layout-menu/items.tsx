import { Icon } from '@iconify/react/offline'

import type { MenuItem } from '@/components/contextmenu'
import { mountOverlayTile, removeOverlayTile } from '@/features/capture/tauri'

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
          void mountOverlayTile(tile.component, tile.id, {
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
          void removeOverlayTile(tile.id)
        }
      }
    ]
  }
}

/**
 * 集合层级靠 `collectionID` 表达。下面两个函数只干一件事：挡掉会成环的移动。
 *
 * 成环的代价是隐形的：面包屑永远走不到头、删父集合也排不掉，只能手工改库。
 */

/** `id` 自己 + 全部祖先（把 `id` 挂进这些集合会成环） */
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

/** `rootID` 自己 + 全部子孙 */
function findSubtree(rootID: string, collections: Tile[]): string[] {
  const out = [rootID]
  for (let i = 0; i < out.length; i += 1) {
    for (const item of collections) {
      if (item.collectionID === out[i] && !out.includes(item.id)) out.push(item.id)
    }
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

  if (isCollection) {
    // 右键落在集合上：把选中的网址收进这个集合。
    // 选中的集合若是本集合的祖先，收进来就成了环，直接别算进「所选」
    const ancestors = findSelfAndAncestors(tile.id, context.collections)
    const joined = movable.filter(function (item) {
      return !ancestors.has(item.id)
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
    // 候选集合去掉「自己与自己的子孙」：那些位置挂进去就是环
    const blocked = new Set<string>()
    for (const item of movable) {
      if (item.component !== 'collection') continue
      for (const id of findSubtree(item.id, context.collections)) blocked.add(id)
    }
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
      children: [
        ...context.collections
          .filter(function (collection) {
            return !blocked.has(collection.id)
          })
          .map(function (collection) {
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
                context.onMoveToCollection(
                  collection.id,
                  targets.map(function (item) {
                    return item.id
                  })
                )
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
            context.onCreateCollection(
              targets.map(function (item) {
                return item.id
              })
            )
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
