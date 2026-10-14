import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'

import { useMarkdownStore } from '@/stores/markdown'
import { t } from '@/views/markdown/locale.ts'

interface FindBarProps {
  onFindNext(): void
  onReplaceOne(): void
  onReplaceAll(): void
}

function FindBar(props: FindBarProps) {
  const findQuery = useMarkdownStore(function (state) {
    return state.findQuery
  })
  const findReplace = useMarkdownStore(function (state) {
    return state.findReplace
  })
  const toSetFindQuery = useMarkdownStore(function (state) {
    return state.toSetFindQuery
  })
  const toSetFindReplace = useMarkdownStore(function (state) {
    return state.toSetFindReplace
  })
  const toSetFindOpen = useMarkdownStore(function (state) {
    return state.toSetFindOpen
  })

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
      <Input
        value={findQuery}
        placeholder={t('FIND_PLACEHOLDER')}
        className="h-7 max-w-56"
        onChange={function (event) {
          toSetFindQuery(event.target.value)
        }}
        onKeyDown={function (event) {
          if (event.key === 'Enter') props.onFindNext()
          if (event.key === 'Escape') toSetFindOpen(false)
        }}
      />
      <Input
        value={findReplace}
        placeholder={t('REPLACE')}
        className="h-7 max-w-40"
        onChange={function (event) {
          toSetFindReplace(event.target.value)
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-7"
        onClick={props.onFindNext}>
        {t('FIND')}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7"
        onClick={props.onReplaceOne}>
        {t('REPLACE')}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7"
        onClick={props.onReplaceAll}>
        {t('REPLACE')} All
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="ml-auto size-7"
        aria-label="Close find"
        onClick={function () {
          toSetFindOpen(false)
        }}>
        <Icon
          icon="lucide:x"
          className="size-4"
        />
      </Button>
    </div>
  )
}

export { FindBar }
