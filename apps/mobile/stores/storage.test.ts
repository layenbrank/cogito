import { mmkvStorage } from '@/stores/storage'

describe('mmkvStorage', () => {
  test('persists string values', () => {
    mmkvStorage.setItem('token', 'abc')
    expect(mmkvStorage.getItem('token')).toBe('abc')
    mmkvStorage.removeItem('token')
    expect(mmkvStorage.getItem('token')).toBeNull()
  })
})
