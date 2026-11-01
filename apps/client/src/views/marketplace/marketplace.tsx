import { useContext, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useShellSurface } from '@/features/window-shell/slots'
import { useMirrorStore } from '@/stores/mirror.ts'
import { MarketplaceBegin } from '@/views/marketplace/workspace/caption.tsx'
import {
  MarketplaceContext,
  MarketplaceProvider
} from '@/views/marketplace/workspace/context.tsx'
import { CaptionActions } from '@/views/marketplace/workspace/customize/caption-actions.tsx'
import { PageSkeleton } from '@/views/marketplace/workspace/skeleton.tsx'
import Workspace from '@/views/marketplace/workspace/workspace.tsx'

function MarketplaceShell() {
  const marketplace = useContext(MarketplaceContext)
  const [isReady, onUpdateReady] = useState(false)

  // Caption 在 ShellFrame 渲染槽，不在本页 Provider 子树内；须把同一 value 挂到槽节点上，
  // 否则 Tabs / 搜索落到 createContext 默认 noop（点了无反应）。
  useShellSurface({
    begin: (
      <MarketplaceContext value={marketplace}>
        <MarketplaceBegin />
      </MarketplaceContext>
    ),
    final:
      marketplace.mode === 'customize' ? (
        <MarketplaceContext value={marketplace}>
          <CaptionActions />
        </MarketplaceContext>
      ) : null,
    scrollable: false
  })

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

  return isReady ? <Workspace /> : <PageSkeleton />
}

/** 市场：顶栏工具簇；右侧仅定制模式挂导入导出 */
export default function Marketplace() {
  return (
    <MarketplaceProvider>
      <MarketplaceShell />
    </MarketplaceProvider>
  )
}
