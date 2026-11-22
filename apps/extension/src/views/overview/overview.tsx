import { Wall } from '@/features/wall/wall.tsx'

/** 当前镜像：只显示还没放进集合的磁贴。 */
export default function Overview() {
  return <Wall collectionID={null} />
}
