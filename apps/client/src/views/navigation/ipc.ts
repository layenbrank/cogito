import { invoke } from '@tauri-apps/api/core'

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

interface BarPlace extends Bounds {
  toolbar: number
  listX: number
  listY: number
  listWidth: number
  listHeight: number
}

interface ExtensionsResult {
  names: string[]
  supported: boolean
}

function openPage(id: string, url: string) {
  return invoke('navigation:open', { body: { id, url } })
}

function activatePage(id: string, bounds: Bounds) {
  return invoke('navigation:activate', { body: { id, ...bounds } })
}

function placePage(id: string, bounds: Bounds) {
  return invoke('navigation:place', { body: { id, ...bounds } })
}

function stackPage(above: boolean) {
  return invoke('navigation:stack', { body: { above } })
}

function cursorInMain() {
  return invoke<{ x: number; y: number } | null>('navigation:cursor')
}

function closePage(id: string) {
  return invoke('navigation:close', { body: { id } })
}

function suspendPages() {
  return invoke('navigation:suspend')
}

function navigatePage(id: string, url: string) {
  return invoke('navigation:navigate', { body: { id, url } })
}

function historyPage(id: string, direction: 'back' | 'forward') {
  return invoke('navigation:navigate', { body: { id, direction } })
}

function openDevtools(id: string) {
  return invoke('navigation:devtools', { body: { id } })
}

function readExtensions() {
  return invoke<ExtensionsResult>('navigation:extensions', { body: { action: 'read' } })
}

function importExtension(path: string) {
  return invoke<ExtensionsResult>('navigation:extensions', {
    body: { action: 'import', path }
  })
}

function removeExtension(name: string) {
  return invoke<ExtensionsResult>('navigation:extensions', {
    body: { action: 'remove', name }
  })
}

const BAR_LABEL = 'navigation-bar'
const BAR_STATE = 'navigation://bar'
const BAR_ACTION = 'navigation://bar-action'
const BAR_READY = 'navigation://bar-ready'
const BAR_FRAME = 'navigation://bar-frame'
const SUGGEST_ROW = 32
const SUGGEST_PAD = 12
const SUGGEST_ITEM_GAP = 4
const SUGGEST_BORDER = 1

interface BarState {
  address: string
  canBack: boolean
  canForward: boolean
  engineKey: string
}

interface BarAction {
  kind: 'submit' | 'back' | 'forward' | 'home' | 'engine' | 'menu' | 'suggest'
  url?: string
  query?: string
  key?: string
  open?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
}

interface BarFrame {
  shown: boolean
}

interface SuggestRow {
  label: string
  url: string
}

interface SuggestFrame {
  open: boolean
  x: number
  y: number
  width: number
  height: number
  rows: SuggestRow[]
  active: number
}

interface CompleteItem {
  id: string
  q: string
  u: string
  t: string
}

function openBar() {
  return invoke('navigation:bar-open')
}

function closeBar() {
  return invoke('navigation:bar-close')
}

function placeBar(bounds: BarPlace) {
  return invoke('navigation:bar-place', { body: bounds })
}

function completeAddress(qry: string) {
  return invoke<{ s: CompleteItem[] }>('navigation:complete', { body: { qry } })
}

export {
  activatePage,
  closePage,
  suspendPages,
  historyPage,
  importExtension,
  navigatePage,
  cursorInMain,
  stackPage,
  completeAddress,
  openBar,
  closeBar,
  openDevtools,
  openPage,
  placeBar,
  placePage,
  readExtensions,
  removeExtension,
  BAR_ACTION,
  BAR_FRAME,
  BAR_LABEL,
  BAR_READY,
  BAR_STATE,
  SUGGEST_BORDER,
  SUGGEST_ITEM_GAP,
  SUGGEST_PAD,
  SUGGEST_ROW
}
export type { BarAction, BarFrame, BarPlace, BarState, Bounds, ExtensionsResult, SuggestFrame, SuggestRow }
