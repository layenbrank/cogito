import { useColorScheme as useSystemColorScheme } from 'react-native'

import { useSettingsStore } from '@/stores/settingsStore'

function useAppColorScheme(): 'light' | 'dark' {
  const system = useSystemColorScheme()
  const theme = useSettingsStore((state) => state.theme)

  if (theme === 'light') {
    return 'light'
  }
  if (theme === 'dark') {
    return 'dark'
  }
  return system === 'dark' ? 'dark' : 'light'
}

export { useAppColorScheme }
