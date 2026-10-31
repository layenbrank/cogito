// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import {
  buildChip,
  documentLength,
  findAtomEndingAt,
  insertChipAt,
  insertTextAt,
  isEmptyDocument,
  locateOffset,
  offsetOf,
  parseDocument,
  readDom,
  replaceRange,
  serializeDocument
} from './composer-document'

describe('parseDocument / serializeDocument', () => {
  it('往返普通文本', function () {
    expect(serializeDocument(parseDocument('hello world'))).toBe('hello world')
  })

  it('把换行折成 break 并原样还原', function () {
    const atoms = parseDocument('a\nb\n\nc')
    expect(atoms.map((atom) => atom.kind)).toEqual(['text', 'break', 'text', 'break', 'break', 'text'])
    expect(serializeDocument(atoms)).toBe('a\nb\n\nc')
  })

  it('把 directive 折成 chip', function () {
    const atoms = parseDocument('看下 :browser[browser-2] 这个页面')
    expect(atoms).toHaveLength(3)
    expect(atoms[1]).toMatchObject({ kind: 'chip', type: 'browser', label: 'browser-2', id: 'browser-2' })
    expect(serializeDocument(atoms)).toBe('看下 :browser[browser-2] 这个页面')
  })

  it('id 与 label 相同时省略冗余的 {name=}', function () {
    const atoms = parseDocument(':file[src/a.ts]{name=src/a.ts}')
    expect(atoms[0]).toMatchObject({ kind: 'chip', type: 'file', label: 'src/a.ts', id: 'src/a.ts' })
    expect(serializeDocument(atoms)).toBe(':file[src/a.ts]')
  })

  it('id 与 label 不同时保留两者', function () {
    const atoms = parseDocument(':browser[example.com]{name=browser-3}')
    expect(atoms[0]).toMatchObject({ label: 'example.com', id: 'browser-3' })
    expect(serializeDocument(atoms)).toBe(':browser[example.com]{name=browser-3}')
  })

  it('空文本得空文档', function () {
    expect(parseDocument('')).toEqual([])
    expect(isEmptyDocument(parseDocument(''))).toBe(true)
  })

  it('连续 chip 不插入多余文本节点', function () {
    const atoms = parseDocument(':browser[a]:browser[b]')
    expect(atoms).toHaveLength(2)
    expect(serializeDocument(atoms)).toBe(':browser[a]:browser[b]')
  })
})

describe('offset 换算', () => {
  it('documentLength 按序列化长度计 chip', function () {
    const atoms = parseDocument('x:browser[browser-2]y')
    // ':browser[browser-2]' 有 19 个字符
    expect(documentLength(atoms)).toBe(1 + 19 + 1)
  })

  it('locateOffset 落在 chip 尾部时归属该 chip', function () {
    const atoms = parseDocument('a:browser[b]b')
    expect(locateOffset(atoms, 1)).toEqual({ atomIndex: 0, charOffset: 1 })
    expect(locateOffset(atoms, 12)).toEqual({ atomIndex: 1, charOffset: 11 })
    expect(locateOffset(atoms, 13)).toEqual({ atomIndex: 2, charOffset: 1 })
  })

  it('locateOffset 越界时钳到末尾', function () {
    const atoms = parseDocument('ab')
    expect(locateOffset(atoms, 99)).toEqual({ atomIndex: 0, charOffset: 2 })
    expect(locateOffset(atoms, -3)).toEqual({ atomIndex: 0, charOffset: 0 })
  })

  it('offsetOf 与 locateOffset 互逆', function () {
    const atoms = parseDocument('ab\ncd:browser[x]ef')
    const total = documentLength(atoms)
    for (let offset = 0; offset <= total; offset += 1) {
      const { atomIndex, charOffset } = locateOffset(atoms, offset)
      expect(offsetOf(atoms, atomIndex, charOffset)).toBe(offset)
    }
  })
})

describe('编辑操作', () => {
  it('insertTextAt 在中间插入并切开文本', function () {
    const atoms = insertTextAt(parseDocument('abcd'), 2, 'XY')
    expect(serializeDocument(atoms)).toBe('abXYcd')
  })

  it('insertChipAt 插入原子 chip', function () {
    const atoms = insertChipAt(parseDocument('ab'), 1, buildChip('browser', 'browser-2', 'browser-2'))
    expect(atoms.map((atom) => atom.kind)).toEqual(['text', 'chip', 'text'])
    expect(serializeDocument(atoms)).toBe('a:browser[browser-2]b')
  })

  it('replaceRange 跨 chip 删除时整体移除', function () {
    const atoms = replaceRange(parseDocument('a:browser[b]c'), 1, 12, [])
    expect(serializeDocument(atoms)).toBe('ac')
  })

  it('findAtomEndingAt 命中 chip 尾部', function () {
    const atoms = parseDocument('a:browser[b]')
    const found = findAtomEndingAt(atoms, documentLength(atoms))
    expect(found?.atom).toMatchObject({ kind: 'chip', id: 'b' })
    expect(found?.start).toBe(1)
  })

  it('findAtomEndingAt 在文本中间返回 null', function () {
    expect(findAtomEndingAt(parseDocument('abc'), 1)).toBeNull()
  })
})

describe('readDom', () => {
  function mount(html: string) {
    const root = document.createElement('div')
    root.innerHTML = html
    return root
  }

  it('单个占位 br 视为空', function () {
    expect(readDom(mount('<br>'))).toEqual([])
  })

  it('读取文本与 br', function () {
    expect(serializeDocument(readDom(mount('a<br>b')))).toBe('a\nb')
  })

  it('从 data-chip-* 还原 chip，不依赖运行时注册表', function () {
    const root = mount(
      '看 <span data-chip-type="browser" data-chip-label="browser-2" data-chip-id="browser-2" contenteditable="false">browser-2</span> 页面'
    )
    const atoms = readDom(root)
    expect(atoms[1]).toMatchObject({ kind: 'chip', type: 'browser', label: 'browser-2', id: 'browser-2' })
    expect(serializeDocument(atoms)).toBe('看 :browser[browser-2] 页面')
  })

  it('块级 div 折成换行', function () {
    expect(serializeDocument(readDom(mount('a<div>b</div><div>c</div>')))).toBe('a\nb\nc')
  })

  it('丢弃浏览器塞进来的行内装饰标签', function () {
    expect(serializeDocument(readDom(mount('a<span style="font-weight:700">b</span>c')))).toBe('abc')
  })

  it('文本节点里的 \\n 也折成 break', function () {
    expect(serializeDocument(readDom(mount('a\nb')))).toBe('a\nb')
  })
})
