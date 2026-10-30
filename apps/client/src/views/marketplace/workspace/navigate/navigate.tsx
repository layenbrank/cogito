import { useContext } from 'react'

import { NAVIGATE_BUCKETS } from '@/constants/marketplace/buckets'
import { Bucket } from '@/views/marketplace/workspace/bucket.tsx'
import { MarketplaceContext } from '@/views/marketplace/workspace/context.tsx'
import Section from '@/views/marketplace/workspace/navigate/section.tsx'

export default function Navigate() {
  const { navigateBucket, onUpdateNavigateBucket } = useContext(MarketplaceContext)

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col px-4 pt-1 pb-4">
      <Bucket
        value={navigateBucket}
        options={NAVIGATE_BUCKETS}
        onUpdate={onUpdateNavigateBucket}
      />
      <Section bucket={navigateBucket} />
    </div>
  )
}
