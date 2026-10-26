/**
 * Provider 统一注册表（对象表驱动；改域只改此文件）
 */
import { bootstrapProviders } from '@/features/command-bar/registry'
import { agentProvider } from '@/features/command-bar/providers/agent'
import { calendarProvider } from '@/features/command-bar/providers/calendar'
import { commandsProvider } from '@/features/command-bar/providers/commands'
import { galleryProvider } from '@/features/command-bar/providers/gallery'
import { knowledgeProvider } from '@/features/command-bar/providers/knowledge'
import { reminderProvider } from '@/features/command-bar/providers/reminder'
import {
  collectionProvider,
  navigationProvider,
  tilesProvider
} from '@/features/command-bar/providers/tiles'
import { webProvider } from '@/features/command-bar/providers/web'
import type { SearchProvider } from '@/features/command-bar/types'

const PROVIDERS: readonly SearchProvider[] = [
  tilesProvider,
  collectionProvider,
  navigationProvider,
  agentProvider,
  calendarProvider,
  reminderProvider,
  galleryProvider,
  knowledgeProvider,
  commandsProvider,
  webProvider
]

let isBootstrapped = false

function bootstrapCommandBar(): void {
  if (isBootstrapped) return
  isBootstrapped = true
  bootstrapProviders(PROVIDERS)
}

export { bootstrapCommandBar, PROVIDERS }
