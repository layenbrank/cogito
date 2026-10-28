import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSessionStore } from '@/stores/session.ts'
import { CaptionAccount } from '@/views/overview/caption/account.tsx'

vi.mock('@/apis/auth.ts', function () {
  return {
    GET_AUTH_PROFILE: vi.fn(function () {
      return Promise.reject(new Error('no profile in unit test'))
    }),
    POST_AUTH_SIGNOUT: vi.fn(function () {
      return Promise.resolve(null)
    })
  }
})

const { openSettingsMock } = vi.hoisted(function () {
  return {
    openSettingsMock: vi.fn(function () {
      return Promise.resolve()
    })
  }
})

vi.mock('@/features/window/open-settings', function () {
  return {
    openSettings: openSettingsMock
  }
})

/** zustand store 是模块级单例：每个用例自己复位 */
afterEach(function () {
  useSessionStore.setState({ user: null, isLoading: false })
  openSettingsMock.mockClear()
})

describe('CaptionAccount', function () {
  it('未登录时渲染登录按钮，点击回调 onSignIn', function () {
    const onSignIn = vi.fn()
    render(<CaptionAccount onSignIn={onSignIn} />)

    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it('已登录时点头像打开菜单，菜单里能退出登录', async function () {
    useSessionStore.setState({
      user: {
        id: 'u1',
        username: 'iwell',
        avatarUrl: null,
        email: null,
        phone: null,
        gender: null,
        birthday: null
      }
    })
    render(<CaptionAccount onSignIn={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: '已登录：iwell' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')

    fireEvent.click(trigger)

    expect(screen.getByText('iwell')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' }))
    await waitFor(function () {
      expect(useSessionStore.getState().user).toBeNull()
    })
  })

  it('已登录时账号设置与外观走同窗 openSettings，不另开窗', function () {
    useSessionStore.setState({
      user: {
        id: 'u1',
        username: 'iwell',
        avatarUrl: null,
        email: null,
        phone: null,
        gender: null,
        birthday: null
      }
    })
    render(<CaptionAccount onSignIn={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '已登录：iwell' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '账号设置' }))
    expect(openSettingsMock).toHaveBeenCalledWith('account')

    fireEvent.click(screen.getByRole('button', { name: '已登录：iwell' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '外观' }))
    expect(openSettingsMock).toHaveBeenCalledWith('appearance')
  })
})
