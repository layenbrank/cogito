import { Icon } from '@iconify/react/offline'
import { Avatar, AvatarImage } from '@cogito/design/components/avatar'
import { Button } from '@cogito/design/components/button'
import { Card } from '@cogito/design/components/card'

import { PANEL_ACTIONS, PANEL_OPTIONS } from './panel-options'

interface PanelListProps {
  onOpenConsole: () => void
}

interface EntriesMarkerProps {
  icon: string
  text: string
}

function EntriesMarker(props: EntriesMarkerProps) {
  return (
    <span className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary">
      <Icon
        icon={props.icon}
        aria-hidden
      />
      {props.text}
    </span>
  )
}

function PanelList(props: PanelListProps) {
  return (
    <Card className="min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-4">
      <div>
        <Button onClick={props.onOpenConsole}>打开控制台</Button>
      </div>
      <ul className="flex flex-col divide-y divide-border/60">
        {PANEL_OPTIONS.map(function (item) {
          return (
            <li
              key={item.label}
              className="flex items-center gap-4 py-3 first:pt-0">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-center gap-3">
                  <Avatar size="lg">
                    <AvatarImage
                      src={item.icon}
                      alt={item.label}
                    />
                  </Avatar>
                  <a
                    href={item.url}
                    className="text-sm font-medium hover:text-primary">
                    {item.label}
                  </a>
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
                <div className="flex items-center gap-4">
                  {PANEL_ACTIONS.map(function (action) {
                    return (
                      <EntriesMarker
                        key={action.key}
                        icon={action.icon}
                        text={action.text}
                      />
                    )
                  })}
                </div>
              </div>
              <img
                draggable={false}
                crossOrigin="anonymous"
                alt="entries-mark"
                src="https://picsum.photos/300"
                className="aspect-video w-56 shrink-0 rounded-lg object-cover xl:w-64"
              />
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

export { PanelList }
export type { PanelListProps }
