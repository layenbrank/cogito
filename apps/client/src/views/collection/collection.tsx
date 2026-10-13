import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { snapCenterToCursor } from '@dnd-kit/modifiers'
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates
} from '@dnd-kit/sortable'
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@i-thinking/design/components/tooltip'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { v4 as UUIDV4 } from 'uuid'
import { CHANNELS } from '@/shared/ipc/channels'

import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { Controller } from '@/views/collection/controller.tsx'
import { OverlayDrawer } from '@/views/collection/drawer.tsx'
import { generateColor } from '@/utils/generate.ts'

const URLS: { value: string; label: string }[] = [
  { value: 'https://www.baidu.com', label: '百度' },
  { value: 'https://www.taobao.com', label: '淘宝' },
  { value: 'https://www.jd.com', label: '京东' },
  { value: 'https://www.weibo.com', label: '微博' },
  { value: 'https://www.douban.com', label: '豆瓣' },
  { value: 'https://www.bilibili.com', label: '哔哩哔哩' },
  { value: 'https://www.zhihu.com', label: '知乎' },
  { value: 'https://www.sina.com.cn', label: '新浪' },
  { value: 'https://www.qq.com', label: 'QQ' },
  { value: 'https://www.163.com', label: '网易' },
  { value: 'https://www.sohu.com', label: '搜狐' },
  { value: 'https://www.ifeng.com', label: '凤凰网' },
  { value: 'https://www.cctv.com', label: '央视网' },
  { value: 'https://www.iqiyi.com', label: '爱奇艺' },
  { value: 'https://www.youku.com', label: '优酷' },
  { value: 'https://www.toutiao.com', label: '今日头条' },
  { value: 'https://www.xiaohongshu.com', label: '小红书' },
  { value: 'https://www.kuaishou.com', label: '快手' },
  { value: 'https://www.meituan.com', label: '美团' },
  { value: 'https://www.dianping.com', label: '大众点评' },
  { value: 'https://www.suning.com', label: '苏宁' },
  { value: 'https://www.vip.com', label: '唯品会' }
]

const MAGNETIC_TILES: MagneticTile[] = URLS.map(function (value, index) {
  const magneticTile: MagneticTile = {
    id: UUIDV4(),
    url: value.value,
    mark: null,
    title: value.label,
    index: index,
    round: '12px',
    size: 1,
    shape: 'square',
    direction: 'vertical',
    mirrorID: 'MIRROR_ID',
    backdrop: null,
    component: 'navigation',
    textColor: '#ffffff',
    updatedAt: Date.now(),
    createdAt: Date.now(),
    archivedAt: null,
    description: value.label,
    collectionID: null,
    downloadCount: 1000,
    background: {
      color: generateColor()
    }
  }
  return magneticTile
})

/**
 * 集合记录 id：窗口 label 约定为 `<component>:<磁贴 id>`（见 `activate.ts`），
 * 优先取查询串（后续若在路由上带 id 则以此为准）。
 */
function findCollectionID(): string {
  const fromQuery = new URLSearchParams(location.search).get('id')
  if (fromQuery) return fromQuery

  try {
    const label = getCurrentWindow().label
    const separator = label.indexOf(':')
    return separator === -1 ? '' : label.slice(separator + 1)
  } catch (error) {
    // 不在 Tauri 窗口里（如测试）时拿不到 label，按空处理
    console.debug('[collection] 取窗口 label 失败，按空处理:', error)
    return ''
  }
}

/** 集合窗口：顶栏新增、内容区是集合内磁贴网格，右侧滑出抽屉用于从全量磁贴中挑选 */
export default function Collection() {
  const id = useMemo(function () {
    return findCollectionID()
  }, [])
  const [drawerVisible, onUpdateDrawerVisible] = useState(false)

  const magneticTiles = useLiveQuery<MagneticTile[], MagneticTile[]>(
    async function () {
      const response = await invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
        params: { collectionID: id }
      })

      if (response.length) return response
      return MAGNETIC_TILES
    },
    [id],
    MAGNETIC_TILES
  )

  const uniqueKeys = useMemo(
    function () {
      const keys = magneticTiles?.map(function (value) {
        return value.id
      })
      return keys ?? []
    },
    [magneticTiles]
  )

  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: {
      tolerance: 0,
      delay: 1000,
      distance: 10 // 需要移动 10px 才激活拖拽，避免误触
    }
  })

  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
    keyboardCodes: {
      start: ['Space', 'Enter'],
      cancel: ['Escape'],
      end: ['Space', 'Enter']
    }
  })

  const sensors = useSensors(mouseSensor, keyboardSensor)

  return (
    <Decorations
      summary={findComponentLabel('collection')}
      final={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="新增磁贴"
                className="rounded-md text-muted-foreground"
                onClick={function () {
                  onUpdateDrawerVisible(true)
                }}
              />
            }>
            <Icon
              icon="lucide:plus"
              aria-hidden
            />
          </TooltipTrigger>
          <TooltipContent side="bottom">新增磁贴</TooltipContent>
        </Tooltip>
      }>
      <div className="px-6 py-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[snapCenterToCursor]}>
          <SortableContext
            items={uniqueKeys}
            strategy={rectSortingStrategy}>
            <Controller magneticTiles={magneticTiles ?? []} />
          </SortableContext>
        </DndContext>
      </div>

      <OverlayDrawer
        id={id}
        visible={drawerVisible}
        onUpdateVisible={onUpdateDrawerVisible}
      />
    </Decorations>
  )
}
