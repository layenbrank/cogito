/* eslint-disable no-var */

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  MediaStreamTrackProcessor: typeof MediaStreamTrackProcessor
}

var MediaStreamTrackProcessor: {
  prototype: MediaStreamTrackProcessor
  new (options: MediaStreamTrack): TransformStream
}
