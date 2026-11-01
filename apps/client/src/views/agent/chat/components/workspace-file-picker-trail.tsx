import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'

function DirectoryTrail(props: {
  relative: string
  onJump: (relative: string) => void
}) {
  if (!props.relative) return null

  const segments = props.relative.split('/').filter(Boolean)
  const crumbs: { label: string; path: string }[] = [{ label: '工作区', path: '' }]
  let acc = ''
  for (const segment of segments) {
    acc = acc ? `${acc}/${segment}` : segment
    crumbs.push({ label: segment, path: acc })
  }

  return (
    <div className="border-border flex min-w-0 items-center gap-0.5 overflow-x-auto border-b px-2 py-1.5">
      {crumbs.map(function (crumb, index) {
        const isLast = index === crumbs.length - 1
        return (
          <div
            key={crumb.path || 'root'}
            className="flex min-w-0 shrink-0 items-center gap-0.5">
            {index > 0 ? (
              <Icon
                icon="lucide:chevron-right"
                className="text-muted-foreground/50 size-3 shrink-0"
              />
            ) : null}
            {isLast ? (
              <span
                className="text-foreground max-w-36 truncate px-1 text-xs font-medium"
                title={crumb.path || '工作区'}>
                {crumb.label}
              </span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground h-auto max-w-28 truncate rounded px-1 py-0.5 text-xs font-normal"
                title={crumb.path || '工作区'}
                onClick={function () {
                  props.onJump(crumb.path)
                }}>
                {crumb.label}
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}

export { DirectoryTrail }
