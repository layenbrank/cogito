import { BUCKETS, type Bucket } from '@/shared/ipc/specs/sidecar'

interface BucketMark {
  label: string
  icon: string
  tile: string
}

const BUCKET_LABELS: Record<Bucket, string> = {
  system: '系统',
  network: '网络',
  data: '数据',
  ui: '界面',
  logic: '逻辑',
  plugin: '插件'
}

const BUCKET_ICONS: Record<Bucket, string> = {
  system: 'mdi:cog-outline',
  network: 'mdi:web',
  data: 'mdi:database-outline',
  ui: 'mdi:monitor',
  logic: 'mdi:code-braces',
  plugin: 'mdi:puzzle-outline'
}

const BUCKET_TILES: Record<Bucket, string> = {
  system: 'bg-secondary text-secondary-foreground',
  network: 'bg-primary/12 text-primary',
  data: 'bg-chart-3/18 text-chart-3',
  ui: 'bg-chart-1/15 text-chart-1',
  logic: 'bg-chart-4/22 text-foreground',
  plugin: 'bg-chart-5/18 text-chart-5'
}

const OTHER_MARK: BucketMark = {
  label: '其他',
  icon: 'mdi:file-outline',
  tile: 'bg-muted text-muted-foreground'
}

function isBucket(value: string | null | undefined): value is Bucket {
  return BUCKETS.includes(value as Bucket)
}

function findBucketMark(bucket: string | null | undefined): BucketMark {
  if (isBucket(bucket)) {
    return { label: BUCKET_LABELS[bucket], icon: BUCKET_ICONS[bucket], tile: BUCKET_TILES[bucket] }
  }
  return OTHER_MARK
}

export { findBucketMark }
export type { BucketMark }
