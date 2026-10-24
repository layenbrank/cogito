import { create } from 'zustand'

import {
  GET_PROFILE,
  POST_SIGNIN,
  POST_SIGNOUT,
  POST_SIGNUP,
  clearSession,
  findSession
} from '@/api/auth'
import { isApiSuccess } from '@/api/http'
import type { Profile, SignInBody, SignUpBody } from '@/types/auth'

interface AuthState {
  userId: string | null
  username: string | null
  token: string | null
  profile: Profile | null
  isHydrated: boolean
  isLoading: boolean
  hydrate: () => Promise<void>
  refreshProfile: () => Promise<void>
  signIn: (data: SignInBody) => Promise<string | null>
  signUp: (data: SignUpBody) => Promise<string | null>
  signOut: () => Promise<void>
}

const useAuthStore = create<AuthState>((set, get) => ({
  userId: null,
  username: null,
  token: null,
  profile: null,
  isHydrated: false,
  isLoading: false,

  async hydrate() {
    const session = findSession()
    if (!session) {
      set({ isHydrated: true })
      return
    }

    set({
      userId: session.userId,
      username: session.username,
      token: session.token,
      isHydrated: true
    })

    const profile = await GET_PROFILE(session.token)
    if (!isApiSuccess(profile.code)) {
      // 300001 / 300002 — clear invalid JWT
      if (profile.code === 300001 || profile.code === 300002) {
        clearSession()
        set({ userId: null, username: null, token: null, profile: null })
      }
      return
    }

    set({
      profile: profile.data,
      userId: profile.data.id,
      username: profile.data.username
    })
  },

  async refreshProfile() {
    const token = get().token
    if (!token) {
      return
    }
    const profile = await GET_PROFILE(token)
    if (isApiSuccess(profile.code)) {
      set({ profile: profile.data, username: profile.data.username, userId: profile.data.id })
    }
  },

  async signIn(data) {
    set({ isLoading: true })
    try {
      const result = await POST_SIGNIN(data)
      if (!isApiSuccess(result.code)) {
        return result.msg
      }
      set({
        userId: result.data.id,
        username: result.data.username,
        token: result.data.token,
        profile: null
      })
      await get().refreshProfile()
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Sign in failed'
    } finally {
      set({ isLoading: false })
    }
  },

  async signUp(data) {
    set({ isLoading: true })
    try {
      const result = await POST_SIGNUP(data)
      if (!isApiSuccess(result.code)) {
        return result.msg
      }
      set({
        userId: result.data.id,
        username: result.data.username,
        token: result.data.token,
        profile: null
      })
      await get().refreshProfile()
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Sign up failed'
    } finally {
      set({ isLoading: false })
    }
  },

  async signOut() {
    await POST_SIGNOUT(get().token)
    set({ userId: null, username: null, token: null, profile: null })
  }
}))

export { useAuthStore }
