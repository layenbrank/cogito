import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

interface ConsoleBookmark {
  id: string
  label: string
  path: string
}

interface ConsolePreference {
  navOrder: string[]
  pinnedNav: string[]
  dashboardWidgets: string[]
  bookmarks: ConsoleBookmark[]
}

interface ConsolePreferenceR extends ConsolePreference {
  id: string
  userID: string
  updatedAt: number
}

const ENV = { env: 'cogito' as const }

async function unwrap<T>(pending: Promise<RSF<T>>): Promise<T> {
  return HttpEnvelope(await pending)
}

function GET_CONSOLE_PREFERENCE() {
  return unwrap(http.get<RSF<ConsolePreferenceR | null>>('/console/preference', ENV))
}

function PUT_CONSOLE_PREFERENCE(body: ConsolePreference) {
  return unwrap(http.put<RSF<ConsolePreferenceR>>('/console/preference', body, ENV))
}

export { GET_CONSOLE_PREFERENCE, PUT_CONSOLE_PREFERENCE }
export type { ConsoleBookmark, ConsolePreference, ConsolePreferenceR }
