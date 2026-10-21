import { toast } from 'sonner'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

import {
  GET_AUTH_PROFILE,
  POST_AUTH_SIGNOUT,
  type AuthProfile
} from '@/apis/auth.ts'
import {
  clearAuthToken,
  clearAuthTokenIfCurrent,
  findAuthToken,
  isSessionInvalid,
  subscribeAuthToken
} from '@/utils/auth.ts'
import { reportCaught } from '@/utils/exception-report.ts'
import { clearActiveTenantCache } from '@/utils/tenant.ts'

interface SessionUser {
  id: string
  username: string
  role: string
  avatarUrl: string | null
  email: string | null
}

interface SessionStore {
  user: SessionUser | null
  isLoading: boolean
  toSignOut: () => void
}

function parseSessionUser(profile: AuthProfile): SessionUser {
  return {
    id: profile.id,
    username: profile.username,
    role: profile.role,
    avatarUrl: profile.avatar?.url ?? null,
    email: profile.email
  }
}

async function hydrateSessionUser(
  set: (partial: Partial<SessionStore>) => void,
  token: string | null
): Promise<void> {
  if (!token) {
    set({ user: null, isLoading: false })
    return
  }

  set({ isLoading: true })
  try {
    const profile = await GET_AUTH_PROFILE()
    set({ user: parseSessionUser(profile), isLoading: false })
  } catch (error) {
    if (isSessionInvalid(error)) {
      clearAuthTokenIfCurrent(token)
      set({ user: null, isLoading: false })
      return
    }
    reportCaught('session.hydrateSessionUser', error)
    set({ isLoading: false })
    toast.error(error instanceof Error ? error.message : '加载会话失败')
  }
}

const useSessionStore = create<SessionStore>()(
  devtools(
    function (set) {
      return {
        user: null,
        isLoading: Boolean(findAuthToken()),
        toSignOut() {
          void POST_AUTH_SIGNOUT().catch(function () {
            /* 本地清令牌即可 */
          })
          clearAuthToken()
          clearActiveTenantCache()
          set({ user: null })
        }
      }
    },
    { name: 'backend-session', enabled: import.meta.env.DEV }
  )
)

subscribeAuthToken(function () {
  void hydrateSessionUser(function (partial) {
    useSessionStore.setState(partial)
  }, findAuthToken())
})

if (findAuthToken()) {
  void hydrateSessionUser(function (partial) {
    useSessionStore.setState(partial)
  }, findAuthToken())
}

export { useSessionStore }
export type { SessionUser }
