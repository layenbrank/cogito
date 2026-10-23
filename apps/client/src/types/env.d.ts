/* eslint-disable no-var */

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

interface Window {
  MediaStreamTrackProcessor: typeof MediaStreamTrackProcessor
  __TAURI__: unknown
}

var MediaStreamTrackProcessor: {
  prototype: MediaStreamTrackProcessor
  new (options: MediaStreamTrack): TransformStream
}

declare type Recordable<T = any> = Record<string, T>

declare module '*.contribution' {
  const src: string
  export default src
}
