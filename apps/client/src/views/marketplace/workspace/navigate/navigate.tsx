import { Button } from '@i-thinking/design/components/button'
import { useContext } from 'react'
import { toast } from 'sonner'

import { NAVIGATE_BUCKETS } from '@/constants/marketplace/buckets'
import { admitSession } from '@/features/magnetic-tile/session'
import { Bucket } from '@/views/marketplace/workspace/bucket.tsx'
import { MarketplaceContext } from '@/views/marketplace/workspace/context.tsx'
import ReSection from '@/views/marketplace/workspace/navigate/section.tsx'

async function openBookmarkImport() {
  try {
    admitSession({
      component: 'bookmark',
      id: 'bookmark',
      url: '',
      path: '/bookmark'
    })
    const { router } = await import('@/routers')
    await router.navigate('/bookmark')
  } catch (error) {
    console.error(error)
    toast.error('无法打开书签导入')
  }
}

export default function Navigate() {
  const { navigateBucket, onUpdateNavigateBucket } = useContext(MarketplaceContext)

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <div className="mx-3 mt-2 flex shrink-0 items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          把 Chrome 书签导入为网址磁贴，之后可随时升格为集合。
        </p>
        <Button
          size="sm"
          onClick={function () {
            void openBookmarkImport()
          }}>
          导入 Chrome 书签
        </Button>
      </div>
      <div className="mt-2 mb-1.5 flex min-h-0 w-full flex-1">
        <Bucket
          value={navigateBucket}
          options={NAVIGATE_BUCKETS}
          onUpdate={onUpdateNavigateBucket}
        />
        <ReSection bucket={navigateBucket} />
      </div>
    </div>
  )
}
