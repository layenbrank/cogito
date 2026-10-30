import { useContext } from 'react'

import { BOOTH_BUCKETS } from '@/constants/marketplace/buckets'
import { Bucket } from '@/views/marketplace/workspace/bucket.tsx'
import Section from '@/views/marketplace/workspace/booth/section.tsx'
import { MarketplaceContext } from '@/views/marketplace/workspace/context.tsx'

export default function Booth() {
  const { boothBucket, onUpdateBoothBucket } = useContext(MarketplaceContext)

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col px-4 pt-1 pb-4">
      <Bucket
        value={boothBucket}
        options={BOOTH_BUCKETS}
        onUpdate={onUpdateBoothBucket}
      />
      <Section bucket={boothBucket} />
    </div>
  )
}
