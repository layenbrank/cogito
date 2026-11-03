import { Icon } from '@iconify/react/offline'

interface PlaceholderSurfaceProps {
  icon: string
  title: string
  description: string
}

function PlaceholderSurface(props: PlaceholderSurfaceProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <Icon
        icon={props.icon}
        className="size-8 text-muted-foreground/50"
      />
      <p className="text-sm font-medium text-foreground">{props.title}</p>
      <p className="max-w-[220px] text-xs leading-relaxed text-muted-foreground">
        {props.description}
      </p>
    </div>
  )
}

export { PlaceholderSurface }
