interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string
  readonly VITE_ENGINE: string
  readonly VITE_COGITO: string
  readonly VITE_INTELLIGENCE: string
  readonly VITE_INTELLIGENCE_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

type EnvURL = 'cogito' | 'engine' | 'intelligence'

declare type Recordable<T = unknown> = Record<string, T>
