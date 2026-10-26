import type { Editor } from '@tiptap/react'

import {
  clearSearchHighlight,
  setSearchHighlight
} from '@/views/knowledge/workspace/search-highlight-extension.ts'

interface FindOptions {
  query: string
  isMatchCase: boolean
  isWholeWord: boolean
  isRegex: boolean
}

interface FindHit {
  from: number
  to: number
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildFinder(options: FindOptions): RegExp | null {
  const raw = options.query
  if (!raw) return null
  try {
    const source = options.isRegex ? raw : escapeRegExp(raw)
    const wrapped = options.isWholeWord ? `\\b(?:${source})\\b` : source
    return new RegExp(wrapped, options.isMatchCase ? 'g' : 'gi')
  } catch (error) {
    console.warn('[markdown] 查找正则无效', error)
    return null
  }
}

function collectHits(editor: Editor, options: FindOptions): FindHit[] {
  const pattern = buildFinder(options)
  if (!pattern) return []
  const hits: FindHit[] = []
  editor.state.doc.descendants(function (node, pos) {
    if (!node.isText || !node.text) return true
    pattern.lastIndex = 0
    let match = pattern.exec(node.text)
    while (match) {
      const from = pos + match.index
      const to = from + match[0].length
      if (to > from) hits.push({ from, to })
      if (!pattern.global) break
      if (match[0].length === 0) pattern.lastIndex += 1
      match = pattern.exec(node.text)
    }
    return true
  })
  return hits
}

function findActiveIndex(hits: FindHit[], from: number, to: number): number {
  return hits.findIndex(function (hit) {
    return hit.from === from && hit.to === to
  })
}

function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let current: HTMLElement | null = node
  while (current) {
    const style = window.getComputedStyle(current)
    const canScroll =
      /(auto|scroll|overlay)/.test(style.overflowY) &&
      current.scrollHeight > current.clientHeight + 1
    if (canScroll) return current
    current = current.parentElement
  }
  return null
}

/** 在编辑滚动容器内丝滑滚到命中处（居中） */
function smoothScrollToHit(editor: Editor, from: number): void {
  const view = editor.view
  let coords: { top: number; bottom: number }
  try {
    coords = view.coordsAtPos(from)
  } catch (error) {
    console.warn('[markdown] 查找滚动定位失败', error)
    return
  }
  const scroller = findScrollParent(view.dom)
  if (!scroller) {
    const dom = view.domAtPos(from)
    ;(dom.node as HTMLElement).parentElement?.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    })
    return
  }

  const scrollerRect = scroller.getBoundingClientRect()
  const hitMid = (coords.top + coords.bottom) / 2
  const visibleTop = scrollerRect.top + 48
  const visibleBottom = scrollerRect.bottom - 48
  // 已在可视区内则不滚，避免抖动
  if (hitMid >= visibleTop && hitMid <= visibleBottom) return

  const offsetInScroller = hitMid - scrollerRect.top + scroller.scrollTop
  const nextTop = offsetInScroller - scroller.clientHeight / 2
  scroller.scrollTo({
    top: Math.max(0, nextTop),
    behavior: 'smooth'
  })
}

function syncHighlight(
  editor: Editor,
  options: FindOptions,
  hit: FindHit | null
): void {
  if (!options.query || !hit) {
    clearSearchHighlight(editor)
    return
  }
  setSearchHighlight(editor, {
    ...options,
    activeFrom: hit.from,
    activeTo: hit.to
  })
}

/** 选中命中项并丝滑滚动；默认不抢焦点，便于查找框连续 Enter */
function selectHit(
  editor: Editor,
  options: FindOptions,
  hit: FindHit,
  shouldFocus = false
): void {
  const chain = editor.chain().setTextSelection({ from: hit.from, to: hit.to })
  if (shouldFocus) chain.focus()
  chain.run()
  syncHighlight(editor, options, hit)
  // 等选区/装饰落盘后再滚，更顺
  requestAnimationFrame(function () {
    smoothScrollToHit(editor, hit.from)
  })
}

/** 实时输入：跳到当前/首个命中，不抢焦点 */
function revealMatch(
  editor: Editor,
  options: FindOptions,
  preferredIndex = 0
): { index: number; total: number } {
  const hits = collectHits(editor, options)
  if (hits.length === 0) {
    clearSearchHighlight(editor)
    return { index: -1, total: 0 }
  }
  const index = Math.min(Math.max(preferredIndex, 0), hits.length - 1)
  selectHit(editor, options, hits[index])
  return { index, total: hits.length }
}

function findStep(
  editor: Editor,
  options: FindOptions,
  direction: 1 | -1
): { index: number; total: number } {
  const hits = collectHits(editor, options)
  if (hits.length === 0) {
    clearSearchHighlight(editor)
    return { index: -1, total: 0 }
  }
  const { from, to } = editor.state.selection
  let index = findActiveIndex(hits, from, to)
  if (index < 0) {
    if (direction > 0) {
      index = hits.findIndex(function (hit) {
        return hit.from >= from
      })
      if (index < 0) index = 0
    } else {
      index = -1
      for (let i = hits.length - 1; i >= 0; i -= 1) {
        if (hits[i].to <= from) {
          index = i
          break
        }
      }
      if (index < 0) index = hits.length - 1
    }
  } else {
    index = (index + direction + hits.length) % hits.length
  }
  selectHit(editor, options, hits[index])
  return { index, total: hits.length }
}

function replaceOne(
  editor: Editor,
  options: FindOptions,
  replacement: string
): { index: number; total: number } {
  const { from, to } = editor.state.selection
  const hits = collectHits(editor, options)
  const active = hits.find(function (hit) {
    return hit.from === from && hit.to === to
  })
  if (active) {
    editor.chain().insertContentAt({ from, to }, replacement).run()
  }
  return findStep(editor, options, 1)
}

function replaceAll(
  editor: Editor,
  options: FindOptions,
  replacement: string
): number {
  const hits = collectHits(editor, options)
  if (hits.length === 0) return 0
  let chain = editor.chain()
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    const hit = hits[i]
    chain = chain.insertContentAt({ from: hit.from, to: hit.to }, replacement)
  }
  chain.run()
  clearSearchHighlight(editor)
  return hits.length
}

function countHits(editor: Editor, options: FindOptions): number {
  return collectHits(editor, options).length
}

export type { FindOptions, FindHit }
export {
  clearSearchHighlight,
  collectHits,
  countHits,
  findStep,
  replaceAll,
  replaceOne,
  revealMatch
}
