/**
 * 待确认指令草稿：agent 生成、尚未写入 corex.db 的指令。
 *
 * 只有这里确认后才会走 `sidecar:saveDirective`；丢弃只是删本地草稿行。
 */
import { Button } from '@cogito/design/components/button'
import { Icon } from '@iconify/react/offline'
import { useEffect } from 'react'

import { openDraftInEditor } from '@/features/agent/directive-draft'
import { useDirectiveDraftStore } from '@/stores/directive-draft'

function DraftInbox() {
  const drafts = useDirectiveDraftStore(function (state) {
    return state.drafts
  })
  const isLoading = useDirectiveDraftStore(function (state) {
    return state.isLoading
  })
  const refresh = useDirectiveDraftStore(function (state) {
    return state.refresh
  })
  const discard = useDirectiveDraftStore(function (state) {
    return state.discard
  })

  useEffect(
    function () {
      void refresh()
    },
    [refresh]
  )

  if (drafts.length === 0) return null

  return (
    <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
        <Icon
          icon="lucide:sparkles"
          className="size-3.5"
        />
        待确认草稿
        <span className="tabular-nums opacity-70">{drafts.length}</span>
        {isLoading ? <span className="opacity-70">刷新中…</span> : null}
      </div>
      <ul className="flex flex-col gap-2">
        {drafts.map(function (draft) {
          return (
            <li
              key={draft.id}
              className="flex items-center justify-between gap-3 rounded-lg bg-background/70 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{draft.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {draft.error ? `校验未通过：${draft.error}` : '由智能体生成，尚未保存到指令库'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={function () {
                    void openDraftInEditor(draft)
                  }}>
                  打开
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="丢弃草稿"
                  onClick={function () {
                    void discard(draft.id)
                  }}>
                  <Icon
                    icon="lucide:trash-2"
                    className="size-4"
                  />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export { DraftInbox }
