import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@i-thinking/design/components/tooltip'

import { formatBindingText } from '@/keyboard/binding'
import { SHORTCUT_COMMAND, resolveBinding } from '@/keyboard/definitions'
import { t } from '@/views/markdown/locale.ts'

interface FocusExitProps {
  onExit(): void
}

function FocusExit(props: FocusExitProps) {
  return (
    <TooltipProvider delay={200}>
      <div className="pointer-events-none absolute top-3 right-3 z-50">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="pointer-events-auto h-8 gap-1.5 rounded-md shadow-md"
                aria-label={t('FOCUS_EXIT')}
                onClick={props.onExit}
              />
            }>
            <Icon
              icon="lucide:minimize-2"
              className="size-3.5"
            />
            <span className="text-xs">{t('FOCUS_EXIT')}</span>
            <kbd className="ml-1 rounded border border-border px-1 font-mono text-[10px] text-muted-foreground">
              Esc
            </kbd>
          </TooltipTrigger>
          <TooltipContent>
            {t('FOCUS_HINT')} ·{' '}
            {formatBindingText(resolveBinding(SHORTCUT_COMMAND.MARKDOWN_FOCUS_TOGGLE))}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}

export { FocusExit }
