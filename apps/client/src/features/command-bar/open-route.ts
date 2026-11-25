/**
 * Omnibar 打开应用路由：admitSession + navigate
 */
import { findTileRoute } from '@/constants/magnetic-tile/window'
import { admitSession } from '@/features/magnetic-tile/session'

async function openComponentRoute(
  component: MagneticTile.Component,
  options?: { path?: string }
): Promise<void> {
  const path = options?.path ?? findTileRoute(component)
  admitSession({ component, path })
  const { router } = await import('@/routers')
  await router.navigate(path)
}

export { openComponentRoute }
