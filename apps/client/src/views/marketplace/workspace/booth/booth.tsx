import { useContext } from 'react'

import { BOOTH_BUCKETS } from '@/constants/marketplace/buckets'
import { Bucket } from '@/views/marketplace/workspace/bucket.tsx'
import ReSection from '@/views/marketplace/workspace/booth/section.tsx'
import { MarketplaceContext } from '@/views/marketplace/workspace/context.tsx'

export default function Booth() {
  const { boothBucket, onUpdateBoothBucket } = useContext(MarketplaceContext)

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <div className="mt-2 mb-1.5 flex min-h-0 w-full flex-1">
        <Bucket
          value={boothBucket}
          options={BOOTH_BUCKETS}
          onUpdate={onUpdateBoothBucket}
        />
        <ReSection bucket={boothBucket} />
      </div>
    </div>
  )
}
