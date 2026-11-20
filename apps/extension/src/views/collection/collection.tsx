import { useParams } from 'react-router-dom'

import { Wall } from '@/features/wall/wall.tsx'

/** 集合里只有一层网址，对应桌面端打开集合窗口。 */
export default function Collection() {
  const params = useParams()
  return <Wall collectionID={params.id ?? null} />
}
