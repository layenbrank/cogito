import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Decorations } from '@/components/decorations/index.ts'
import { useMirrorStore } from '@/stores/mirror.ts'
import { Caption } from '@/views/marketplace/workspace/caption.tsx'
import {
  MarketplaceProvider,
  type MarketplaceMode
} from '@/views/marketplace/workspace/context.tsx'
import { CaptionActions } from '@/views/marketplace/workspace/customize/caption-actions.tsx'
import { PageSkeleton } from '@/views/marketplace/workspace/skeleton.tsx'
import Workspace from '@/views/marketplace/workspace/workspace.tsx'

/** 市场窗口：顶栏左侧是工具簇（镜像 / 模式 / 搜索 / 元信息），右侧只在定制模式挂导入导出 */
export default function Marketplace() {
  const [mode, onUpdateMode] = useState<MarketplaceMode>('booth')
  const [isReady, onUpdateReady] = useState(false)

  useEffect(function () {
    let cancelled = false

    async function bootstrap() {
      try {
        await useMirrorStore.getState().toInitialize()
      } catch (error) {
        console.error('[Marketplace] 镜像加载失败:', error)
        if (!cancelled) toast.error('镜像加载失败')
      } finally {
        if (!cancelled) onUpdateReady(true)
      }
    }

    void bootstrap()
    return function () {
      cancelled = true
    }
  }, [])

  return (
    <MarketplaceProvider
      mode={mode}
      onUpdateMode={onUpdateMode}>
      <Decorations
        begin={<Caption />}
        final={mode === 'customize' ? <CaptionActions /> : null}
        scrollable={false}>
        {isReady ? <Workspace /> : <PageSkeleton />}
      </Decorations>
    </MarketplaceProvider>
  )
}
