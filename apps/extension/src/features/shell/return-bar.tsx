import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useNavigate } from 'react-router-dom'

import { Glyph } from '@/features/shell/glyph.tsx'

/** 书签库、设置页回到当前镜像。镜像本身不放顶栏。 */
export function ReturnBar(props: { title: string }) {
  const navigate = useNavigate()

  return (
    <div className={clsx('flex items-center gap-3')}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={function () {
          void navigate('/overview')
        }}>
        <Glyph name="arrow" />
        返回镜像
      </Button>
      <h1 className={clsx('text-base font-medium')}>{props.title}</h1>
    </div>
  )
}
