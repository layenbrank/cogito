import { fireEvent, render, waitFor } from '@testing-library/react-native'

import LoginScreen from '@/app/(auth)/login'

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  Link: ({ children }: { children: React.ReactNode }) => children
}))

jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: { signIn: jest.Mock; isLoading: boolean }) => unknown) =>
    selector({
      signIn: jest.fn(async () => 'Invalid username or password'),
      isLoading: false
    })
}))

describe('LoginScreen', () => {
  test('shows validation error on empty submit', async () => {
    const { getByRole, getByText } = render(<LoginScreen />)

    fireEvent.press(getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(getByText('用户名至少 2 个字符')).toBeTruthy()
    })
  })
})
