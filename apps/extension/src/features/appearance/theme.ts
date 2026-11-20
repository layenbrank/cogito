export type ThemeName = 'light' | 'dark' | 'system'

const THEME_KEY = 'cogito.theme'
const THEME_EVENT = 'cogito-theme'

function publish(theme: ThemeName): void {
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }))
}

export function subscribeTheme(listener: (theme: ThemeName) => void): () => void {
  function onTheme(event: Event): void {
    const detail = (event as CustomEvent<ThemeName>).detail
    listener(parseTheme(detail))
  }

  window.addEventListener(THEME_EVENT, onTheme)
  return function () {
    window.removeEventListener(THEME_EVENT, onTheme)
  }
}

export function parseTheme(value: unknown): ThemeName {
  if (value === 'light' || value === 'dark' || value === 'system') return value
  return 'system'
}

export function isDarkTheme(theme: ThemeName, prefersDark: boolean): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return prefersDark
}

let current: ThemeName = 'system'

function paint(theme: ThemeName): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', isDarkTheme(theme, prefersDark))
}

function findStorage(): chrome.storage.StorageArea | null {
  const local = globalThis.chrome?.storage?.local
  return local ?? null
}

/** 先用本地缓存上色，再跟扩展存储对齐，避免新标签闪一下 */
export function bootstrapAppearance(): void {
  current = parseTheme(localStorage.getItem(THEME_KEY))
  paint(current)

  const storage = findStorage()
  if (storage) {
    void storage
      .get(THEME_KEY)
      .then(function (bag) {
        current = parseTheme(bag[THEME_KEY])
        localStorage.setItem(THEME_KEY, current)
        paint(current)
        publish(current)
      })
      .catch(function (error: unknown) {
        console.error('[theme] 读取外观失败', error)
      })
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if (current === 'system') paint(current)
  })
}

export async function writeTheme(theme: ThemeName): Promise<void> {
  current = theme
  localStorage.setItem(THEME_KEY, theme)
  paint(theme)
  publish(theme)

  const storage = findStorage()
  if (!storage) return

  try {
    await storage.set({ [THEME_KEY]: theme })
  } catch (error) {
    console.error('[theme] 保存外观失败', error)
    throw error
  }
}

export function findTheme(): ThemeName {
  return current
}
