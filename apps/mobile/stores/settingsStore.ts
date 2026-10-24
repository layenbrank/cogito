import { create } from 'zustand'

import { mmkvStorage } from '@/stores/storage'

type ThemePreference = 'system' | 'light' | 'dark'
type LanguagePreference = 'zh' | 'en'

interface SettingsState {
  theme: ThemePreference
  language: LanguagePreference
  hydrate: () => void
  setTheme: (theme: ThemePreference) => void
  setLanguage: (language: LanguagePreference) => void
}

const SETTINGS_KEY = 'app:settings'

interface StoredSettings {
  theme: ThemePreference
  language: LanguagePreference
}

function readSettings(): StoredSettings {
  const raw = mmkvStorage.getItem(SETTINGS_KEY)
  if (!raw) {
    return { theme: 'system', language: 'zh' }
  }
  const parsed = JSON.parse(raw) as Partial<StoredSettings>
  return {
    theme: parsed.theme ?? 'system',
    language: parsed.language ?? 'zh'
  }
}

function writeSettings(settings: StoredSettings) {
  mmkvStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

const useSettingsStore = create<SettingsState>((set) => ({
  theme: 'system',
  language: 'zh',

  hydrate() {
    set(readSettings())
  },

  setTheme(theme) {
    set({ theme })
    const current = readSettings()
    writeSettings({ ...current, theme })
  },

  setLanguage(language) {
    set({ language })
    const current = readSettings()
    writeSettings({ ...current, language })
  }
}))

export type { LanguagePreference, ThemePreference }
export { useSettingsStore }
