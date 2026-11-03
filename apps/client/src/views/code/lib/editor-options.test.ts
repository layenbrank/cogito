import { describe, expect, it } from 'vitest'

import type { CodeEditorPrefs } from '@/stores/code'
import { toEditorOptions } from '@/views/code/lib/editor-options.ts'

function makePrefs(patch: Partial<CodeEditorPrefs> = {}): CodeEditorPrefs {
  return {
    fontSize: 13,
    lineHeightRatio: 1.55,
    fontFamily: '',
    isLigaturesEnabled: true,
    wordWrap: 'off',
    wordWrapColumn: 100,
    isMinimapEnabled: true,
    isStickyScrollEnabled: true,
    renderWhitespace: 'selection',
    isBracketGuidesEnabled: true,
    isSemanticHighlightingEnabled: true,
    tabSize: 2,
    insertSpaces: true,
    ...patch
  }
}

describe('toEditorOptions', function () {
  it('bounded 时下发列宽', function () {
    const options = toEditorOptions(makePrefs({ wordWrap: 'bounded', wordWrapColumn: 88 }))
    expect(options.wordWrap).toBe('bounded')
    expect(options.wordWrapColumn).toBe(88)
  })

  it('off 时忽略列宽', function () {
    const options = toEditorOptions(makePrefs({ wordWrap: 'off', wordWrapColumn: 88 }))
    expect('wordWrapColumn' in options).toBe(false)
  })

  it('空白符三档原样映射', function () {
    expect(toEditorOptions(makePrefs({ renderWhitespace: 'none' })).renderWhitespace).toBe('none')
    expect(toEditorOptions(makePrefs({ renderWhitespace: 'all' })).renderWhitespace).toBe('all')
  })

  it('小地图 / 粘性滚动 / 括号导线 / 语义高亮布尔透传', function () {
    const options = toEditorOptions(
      makePrefs({
        isMinimapEnabled: false,
        isStickyScrollEnabled: false,
        isBracketGuidesEnabled: false,
        isSemanticHighlightingEnabled: false
      })
    )
    expect(options.minimap?.enabled).toBe(false)
    expect(options.stickyScroll?.enabled).toBe(false)
    expect(options.guides?.bracketPairs).toBe(false)
    expect(options.semanticHighlighting?.enabled).toBe(false)
  })

  it('缩进下发 tabSize / insertSpaces', function () {
    const options = toEditorOptions(makePrefs({ tabSize: 4, insertSpaces: false }))
    expect(options.tabSize).toBe(4)
    expect(options.insertSpaces).toBe(false)
  })
})
