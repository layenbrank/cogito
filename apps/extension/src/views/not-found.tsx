import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useNavigate } from 'react-router-dom'

/** 404 页（原 Vue `not-found-view.vue` 的 shadcn 版本） */
export default function NotFound() {
  const navigate = useNavigate()

  return (
    <div
      className={clsx(
        'flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center'
      )}>
      <span className={clsx('text-5xl font-semibold tabular-nums')}>404</span>
      <h1 className={clsx('text-lg font-medium')}>资源不存在</h1>
      <p className={clsx('text-sm text-muted-foreground')}>生活总归带点荒谬</p>
      <Button
        type="button"
        variant="secondary"
        onClick={function () {
          void navigate('/overview')
        }}>
        找点乐子吧
      </Button>
    </div>
  )
}
