import { Wall } from '@/features/wall/wall.tsx'

/** 新标签墙面：只显示还没放进集合的磁贴。 */
export default function Overview() {
  return <Wall collectionID={null} />
}
