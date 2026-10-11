import { useState } from 'react'

import { Decorations } from '@/components/decorations/index.ts'
import { Caption } from '@/views/marketplace/workspace/caption.tsx'
import {
  MarketplaceProvider,
  type MarketplaceMode
} from '@/views/marketplace/workspace/context.tsx'
import { CaptionActions } from '@/views/marketplace/workspace/customize/caption-actions.tsx'
import Workspace from '@/views/marketplace/workspace/workspace.tsx'

/** 市场窗口：顶栏左侧是工具簇（镜像 / 模式 / 搜索 / 元信息），右侧只在定制模式挂导入导出 */
export default function Marketplace() {
  const [mode, onUpdateMode] = useState<MarketplaceMode>('booth')

  return (
    <MarketplaceProvider
      mode={mode}
      onUpdateMode={onUpdateMode}>
      <Decorations
        begin={<Caption />}
        final={mode === 'customize' ? <CaptionActions /> : null}
        scrollable={false}>
        <Workspace />
      </Decorations>
    </MarketplaceProvider>
  )
}
