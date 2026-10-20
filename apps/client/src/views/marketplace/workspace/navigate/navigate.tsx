import { useContext } from 'react'

import { NAVIGATE_BUCKETS } from '@/constants/marketplace/buckets'
import { Bucket } from '@/views/marketplace/workspace/bucket.tsx'
import { MarketplaceContext } from '@/views/marketplace/workspace/context.tsx'
import ReSection from '@/views/marketplace/workspace/navigate/section.tsx'

export default function Navigate() {
  const { navigateBucket, onUpdateNavigateBucket } = useContext(MarketplaceContext)

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
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
