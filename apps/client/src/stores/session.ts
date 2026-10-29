import { toast } from 'sonner'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

import {
  GET_AUTH_PROFILE,
  POST_AUTH_SIGNOUT,
  PUT_AUTH_PROFILE,
  type AuthProfile,
  type AuthProfilePatch
} from '@/apis/auth.ts'
import {
  clearAuthToken,
  clearAuthTokenIfCurrent,
  findAuthToken,
  isSessionInvalid,
  subscribeAuthToken
} from '@/utils/auth.ts'
import { reportCaught } from '@/utils/exception-report'
import { findCogitoMediaUrl } from '@/utils/http/media.ts'

type SessionUser = {
  id: string
  username: string
  avatarUrl: string | null
  email: string | null
  phone: string | null
  gender: string | null
  birthday: string | null
}

type SessionStore = {
  user: SessionUser | null
  /** 有令牌、资料尚未到手 */
  isLoading: boolean
  toSignOut: () => void
  toUpdateProfile: (patch: AuthProfilePatch) => Promise<SessionUser>
}

let isHydrating = false

function parseSessionUser(profile: AuthProfile): SessionUser {
  return {
    id: profile.id,
    username: profile.username,
    avatarUrl: findCogitoMediaUrl(profile.avatar?.url),
    email: profile.email,
    phone: profile.phone,
    gender: profile.gender,
    birthday: profile.birthday
  }
}

async function hydrateSessionUser(
  setters: (partial: Partial<SessionStore>, replace?: false, action?: string) => void
) {
  const token = findAuthToken()
  if (!token) {
    setters({ user: null, isLoading: false }, false, 'hydrate/clear')
    return
  }

  setters({ isLoading: true }, false, 'hydrate/start')
  if (isHydrating) return
  isHydrating = true

  try {
    const profile = await GET_AUTH_PROFILE()
    setters(
      {
        user: parseSessionUser(profile),
        isLoading: false
      },
      false,
      'hydrate/profile'
    )
  } catch (error) {
    if (isSessionInvalid(error)) {
      clearAuthTokenIfCurrent(token)
      setters({ user: null, isLoading: false }, false, 'hydrate/invalid')
      return
    }
    // 网络不通：保留令牌，界面先按未拿到资料处理
    reportCaught('session.hydrate', error, 'warning')
    setters({ isLoading: false }, false, 'hydrate/unavailable')
  } finally {
    isHydrating = false
  }
}

const useSessionStore = create<SessionStore>()(
  devtools(
    function (set) {
      return {
        user: null,
        isLoading: Boolean(findAuthToken()),

        toSignOut() {
          void (async function () {
            try {
              await POST_AUTH_SIGNOUT()
            } catch (error) {
              // 服务端没记上黑名单也不困住用户：本地照样退出
              console.warn('[session] 服务端登出失败，仅清理本地令牌', error)
            }
            clearAuthToken()
            toast.success('已退出登录')
          })()
        },

        async toUpdateProfile(patch) {
          const profile = await PUT_AUTH_PROFILE(patch)
          const user = parseSessionUser(profile)
          set({ user }, false, 'profile/update')
          return user
        }
      }
    },
    {
      name: 'SessionStore',
      enabled: import.meta.env.DEV
    }
  )
)

/** 令牌变化（本窗 writeAuthToken / 他窗 auth:changed）时重拉资料 */
subscribeAuthToken(function () {
  void hydrateSessionUser(writeSessionState)
})

// 启动时若已有令牌，立刻补资料
if (findAuthToken()) {
  void hydrateSessionUser(writeSessionState)
}

/** 显式转发一层：直接把 store.setState 当回调传会丢 this（也会被 unbound-method 拦下） */
function writeSessionState(
  partial: Partial<SessionStore>,
  replace?: false,
  action?: string
): void {
  useSessionStore.setState(partial, replace, action)
}

export { useSessionStore }
export type { SessionUser }
