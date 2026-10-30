import { useContext, useMemo } from 'react'

import { COMMAND } from '@/keyboard/definitions/ids'
import { useCommands } from '@/keyboard/react'
import type { Command } from '@/keyboard/types'
import { MarketplaceContext } from '@/views/marketplace/workspace/context.tsx'

/** 市场窗快捷键：聚焦搜索 / 切模式 / 清搜索 */
function useMarketplaceHotkeys() {
  const context = useContext(MarketplaceContext)
  const { mode, query, onUpdateMode, onUpdateQuery } = context

  const commands = useMemo(
    function (): Command[] {
      return [
        {
          id: COMMAND.MARKETPLACE_FOCUS_SEARCH,
          title: '市场：聚焦搜索',
          when() {
            return mode !== 'customize'
          },
          run() {
            context.focusSearch()
          }
        },
        {
          id: COMMAND.MARKETPLACE_MODE_BOOTH,
          title: '市场：磁贴',
          run() {
            onUpdateQuery('')
            onUpdateMode('booth')
          }
        },
        {
          id: COMMAND.MARKETPLACE_MODE_NAVIGATE,
          title: '市场：网址',
          run() {
            onUpdateQuery('')
            onUpdateMode('navigate')
          }
        },
        {
          id: COMMAND.MARKETPLACE_MODE_CUSTOMIZE,
          title: '市场：定制',
          run() {
            onUpdateQuery('')
            onUpdateMode('customize')
          }
        },
        {
          id: COMMAND.MARKETPLACE_CLEAR_SEARCH,
          title: '市场：清除搜索',
          when() {
            return query.trim().length > 0
          },
          run() {
            context.clearQuery()
          }
        }
      ]
    },
    [context, mode, query, onUpdateMode, onUpdateQuery]
  )

  useCommands(commands)
}

export { useMarketplaceHotkeys }
