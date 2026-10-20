/**
 * 键盘命令 provider
 */
import { OMNIBAR_UI } from '@/features/command-bar/constants'
import type { Hit, SearchProvider } from '@/features/command-bar/types'
import { findCommands, runCommand } from '@/keyboard/commands'

function searchCommands(query: string): Hit[] {
  return findCommands(query)
    .slice(0, OMNIBAR_UI.LOCAL_LIMIT)
    .map(function (command, index) {
      return {
        domain: 'command' as const,
        id: command.id,
        title: command.title,
        subtitle: command.keywords || command.id,
        score: 1 - index * 0.01,
        icon: 'lucide:terminal',
        async run() {
          await runCommand(command.id)
        }
      }
    })
}

const commandsProvider: SearchProvider = {
  domain: 'command',
  search(query) {
    return searchCommands(query)
  }
}

export { commandsProvider }
