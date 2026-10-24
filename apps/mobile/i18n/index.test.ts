import i18n from '@/i18n'

describe('i18n', () => {
  test('returns submit translation', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.t('submit')).toBe('Submit')
  })
})
