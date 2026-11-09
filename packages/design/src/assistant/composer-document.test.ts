// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import {
  buildChip,
  documentLength,
  findAtomEndingAt,
  findAtomStartingAt,
  insertChipAt,
  insertTextAt,
  isEmptyDocument,
  locateOffset,
  offsetOf,
  parseDocument,
  readDom,
  replaceRange,
  serializeDocument,
  serializeTriggerText,
  splitChipLabel
} from './composer-document'

/** 浏览器标签页 id：真正的 UUID 形态，`browser-2` 这种短 id 不再识别 */
const TAB = 'browser-fc893ce2-4290-416f-b07b-78ae4a992e40'
const TAB_MENTION = `@${TAB}`

describe('parseDocument / serializeDocument', () => {
  it('往返普通文本', function () {
    expect(serializeDocument(parseDocument('hello world'))).toBe('hello world')
  })

  it('把换行折成 break 并原样还原', function () {
    const atoms = parseDocument('a\nb\n\nc')
    expect(atoms.map((atom) => atom.kind)).toEqual([
      'text',
      'break',
      'text',
      'break',
      'break',
      'text'
    ])
    expect(serializeDocument(atoms)).toBe('a\nb\n\nc')
  })

  it('@路径 折成 file chip，label 就是引用路径', function () {
    const atoms = parseDocument('@apps/a/b.ts')
    expect(atoms).toHaveLength(1)
    expect(atoms[0]).toMatchObject({
      kind: 'chip',
      type: 'file',
      label: 'apps/a/b.ts',
      id: 'apps/a/b.ts',
      serialized: '@apps/a/b.ts'
    })
    expect(serializeDocument(atoms)).toBe('@apps/a/b.ts')
  })

  it('夹在句子里的 @路径 往返恒等', function () {
    const atoms = parseDocument('看下 @apps/client/src/a.ts 这个文件')
    expect(atoms).toHaveLength(3)
    expect(atoms[1]).toMatchObject({ kind: 'chip', type: 'file', id: 'apps/client/src/a.ts' })
    expect(serializeDocument(atoms)).toBe('看下 @apps/client/src/a.ts 这个文件')
  })

  it('含空白的路径用引号包裹并往返恒等', function () {
    const atoms = parseDocument('@"apps/my dir/a.ts"')
    expect(atoms).toHaveLength(1)
    expect(atoms[0]).toMatchObject({
      kind: 'chip',
      type: 'file',
      label: 'apps/my dir/a.ts',
      id: 'apps/my dir/a.ts'
    })
    expect(serializeDocument(atoms)).toBe('@"apps/my dir/a.ts"')
  })

  it('路径里的引号被转义并能还原', function () {
    const text = '@"apps/a\\"b.ts"'
    const atoms = parseDocument(text)
    expect(atoms[0]).toMatchObject({ kind: 'chip', id: 'apps/a"b.ts' })
    expect(serializeDocument(atoms)).toBe(text)
  })

  it('@browser-<uuid> 解析为 browser chip', function () {
    const atoms = parseDocument(TAB_MENTION)
    expect(atoms[0]).toMatchObject({ kind: 'chip', type: 'browser', id: TAB, label: TAB })
    expect(serializeDocument(atoms)).toBe(TAB_MENTION)
  })

  it('@skill:<name> 解析为 skill chip，label 去掉前缀', function () {
    const atoms = parseDocument('@skill:dingtalk-aitable')
    expect(atoms[0]).toMatchObject({
      kind: 'chip',
      type: 'skill',
      id: 'skill:dingtalk-aitable',
      label: 'dingtalk-aitable'
    })
    expect(serializeDocument(atoms)).toBe('@skill:dingtalk-aitable')
  })

  it('不兼容旧 directive：只剩一段文本，往返文本不变', function () {
    const text = ':file[src/a.ts]{name=src/a.ts}'
    const atoms = parseDocument(text)
    expect(atoms).toEqual([{ kind: 'text', text }])
    expect(serializeDocument(atoms)).toBe(text)
  })

  it('旧 directive 与 @ 混排时只有 @ 变 chip', function () {
    const atoms = parseDocument(':browser[页面标题]{name=browser-2} @apps/a.ts')
    expect(atoms.map((atom) => atom.kind)).toEqual(['text', 'chip'])
    expect(atoms[1]).toMatchObject({ type: 'file', id: 'apps/a.ts' })
    expect(serializeDocument(atoms)).toBe(':browser[页面标题]{name=browser-2} @apps/a.ts')
  })

  it('不误伤邮箱：user@example.com 是普通文本', function () {
    const atoms = parseDocument('user@example.com')
    expect(atoms.every((atom) => atom.kind === 'text')).toBe(true)
    expect(serializeDocument(atoms)).toBe('user@example.com')
  })

  it('不误伤代码里的 @：@Component / @media 是普通文本', function () {
    for (const text of [
      '@Component({ selector })',
      '@media (min-width: 600px)',
      '@types',
      '@browser-2'
    ]) {
      const atoms = parseDocument(text)
      expect(atoms.some((atom) => atom.kind === 'chip')).toBe(false)
      expect(serializeDocument(atoms)).toBe(text)
    }
  })

  it('中文紧邻 @ 也算 token 边界', function () {
    const atoms = parseDocument('看下@apps/a.ts')
    expect(atoms.map((atom) => atom.kind)).toEqual(['text', 'chip'])
    expect(atoms[1]).toMatchObject({ kind: 'chip', id: 'apps/a.ts' })
    expect(serializeDocument(atoms)).toBe('看下@apps/a.ts')
  })

  it('未闭合的引号按普通文本处理', function () {
    const text = '@"apps/a b.ts'
    expect(serializeDocument(parseDocument(text))).toBe(text)
    expect(parseDocument(text).some((atom) => atom.kind === 'chip')).toBe(false)
  })

  it('空文本得空文档', function () {
    expect(parseDocument('')).toEqual([])
    expect(isEmptyDocument(parseDocument(''))).toBe(true)
  })

  it('连续 chip 不插入多余文本节点', function () {
    const atoms = parseDocument(`@apps/a.ts,${TAB_MENTION}`)
    expect(atoms.map((atom) => atom.kind)).toEqual(['chip', 'text', 'chip'])
    expect(serializeDocument(atoms)).toBe(`@apps/a.ts,${TAB_MENTION}`)
  })

  it('buildChip 的序列化与 parse 互逆', function () {
    expect(buildChip('file', 'apps/a.ts', 'apps/a.ts').serialized).toBe('@apps/a.ts')
    expect(buildChip('file', 'apps/my dir/a.ts', 'apps/my dir/a.ts').serialized).toBe(
      '@"apps/my dir/a.ts"'
    )
    expect(buildChip('skill', 'x', 'skill:x').serialized).toBe('@skill:x')
    for (const id of ['apps/a.ts', 'apps/my dir/a.ts', 'skill:x', TAB]) {
      const chip = buildChip('file', id, id)
      const parsed = parseDocument(serializeDocument([chip]))
      expect(parsed).toHaveLength(1)
      expect(parsed[0]).toMatchObject({ kind: 'chip', id })
    }
  })
})

describe('offset 换算', () => {
  it('documentLength 按序列化长度计 chip', function () {
    const atoms = parseDocument(`x ${TAB_MENTION} y`)
    expect(atoms.map((atom) => atom.kind)).toEqual(['text', 'chip', 'text'])
    expect(documentLength(atoms)).toBe(2 + TAB_MENTION.length + 2)
  })

  it('locateOffset 落在 chip 尾部时归属该 chip', function () {
    const atoms = parseDocument(`a ${TAB_MENTION}`)
    expect(locateOffset(atoms, 1)).toEqual({ atomIndex: 0, charOffset: 1 })
    expect(locateOffset(atoms, 2 + TAB_MENTION.length)).toEqual({
      atomIndex: 1,
      charOffset: TAB_MENTION.length
    })
  })

  it('locateOffset 越界时钳到末尾', function () {
    const atoms = parseDocument('ab')
    expect(locateOffset(atoms, 99)).toEqual({ atomIndex: 0, charOffset: 2 })
    expect(locateOffset(atoms, -3)).toEqual({ atomIndex: 0, charOffset: 0 })
  })

  it('offsetOf 与 locateOffset 互逆', function () {
    const atoms = parseDocument(`ab\ncd${TAB_MENTION}ef @skill:x`)
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
    const atoms = insertChipAt(parseDocument('ab'), 1, buildChip('browser', TAB, TAB))
    expect(atoms.map((atom) => atom.kind)).toEqual(['text', 'chip', 'text'])
    expect(serializeDocument(atoms)).toBe(`a${TAB_MENTION}b`)
  })

  it('replaceRange 跨 chip 删除时整体移除', function () {
    const atoms = replaceRange(parseDocument(`x ${TAB_MENTION} y`), 2, 2 + TAB_MENTION.length, [])
    expect(serializeDocument(atoms)).toBe('x  y')
  })

  it('findAtomEndingAt 命中 chip 尾部', function () {
    const atoms = parseDocument(`a ${TAB_MENTION}`)
    const found = findAtomEndingAt(atoms, documentLength(atoms))
    expect(found?.atom).toMatchObject({ kind: 'chip', id: TAB })
    expect(found?.start).toBe(2)
  })

  it('findAtomEndingAt 在文本中间返回 null', function () {
    expect(findAtomEndingAt(parseDocument('abc'), 1)).toBeNull()
  })

  it('findAtomStartingAt 命中 chip 头部，与 findAtomEndingAt 对称', function () {
    const atoms = parseDocument(`a ${TAB_MENTION} b`)
    const start = 2
    const end = start + TAB_MENTION.length
    expect(findAtomStartingAt(atoms, start)?.atom).toMatchObject({ kind: 'chip', id: TAB })
    expect(findAtomEndingAt(atoms, end)?.atom).toMatchObject({ kind: 'chip', id: TAB })
    // 边界两侧各归一个原子：chip 之前是文本，chip 之后也是文本
    expect(findAtomEndingAt(atoms, start)?.atom).toMatchObject({ kind: 'text' })
    expect(findAtomStartingAt(atoms, end)?.atom).toMatchObject({ kind: 'text' })
  })

  it('两个 findAtom* 在内部边界同时命中、原子内部同时落空', function () {
    const atoms = parseDocument(`ab\n${TAB_MENTION}cd @skill:x`)
    const total = documentLength(atoms)
    for (let offset = 1; offset < total; offset += 1) {
      const ending = findAtomEndingAt(atoms, offset)
      const starting = findAtomStartingAt(atoms, offset)
      expect(ending !== null).toBe(starting !== null)
    }
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
      `看 <span data-chip-type="browser" data-chip-label="${TAB}" data-chip-id="${TAB}" contenteditable="false">${TAB}</span> 页面`
    )
    const atoms = readDom(root)
    expect(atoms[1]).toMatchObject({ kind: 'chip', type: 'browser', label: TAB, id: TAB })
    expect(serializeDocument(atoms)).toBe(`看 ${TAB_MENTION} 页面`)
  })

  it('chip 的 data-chip-label 只是视图，序列化忽略它', function () {
    const root = mount(
      '<span data-chip-type="skill" data-chip-label="dingtalk-aitable" data-chip-id="skill:dingtalk-aitable" contenteditable="false">dingtalk-aitable</span>'
    )
    const atoms = readDom(root)
    expect(atoms[0]).toMatchObject({ kind: 'chip', type: 'skill', label: 'dingtalk-aitable' })
    expect(serializeDocument(atoms)).toBe('@skill:dingtalk-aitable')
  })

  it('block 级 div 折成换行', function () {
    expect(serializeDocument(readDom(mount('a<div>b</div><div>c</div>')))).toBe('a\nb\nc')
  })

  it('丢弃浏览器塞进来的行内装饰标签', function () {
    expect(serializeDocument(readDom(mount('a<span style="font-weight:700">b</span>c')))).toBe(
      'abc'
    )
  })

  it('文本节点里的换行也折成 break', function () {
    expect(serializeDocument(readDom(mount('a\nb')))).toBe('a\nb')
  })
})

describe('serializeTriggerText', function () {
  it('把 chip 遮成等长占位符：确认之后紧接着打字不会再被当成 @ 查询', function () {
    const atoms = parseDocument('@apps/client/src/a.ts')
    const wire = serializeDocument(atoms)
    const triggerText = serializeTriggerText(atoms)
    expect(triggerText).toHaveLength(wire.length)
    expect(triggerText).not.toContain('@')
    expect(triggerText).toBe('\uFFFC'.repeat(wire.length))
  })

  it('普通文本与换行原样保留，长度仍与文档一致', function () {
    const atoms = parseDocument('看下@apps/a.ts\n然后')
    const mask = '\uFFFC'.repeat('@apps/a.ts'.length)
    expect(serializeTriggerText(atoms)).toBe(`看下${mask}\n然后`)
    expect(serializeTriggerText(atoms)).toHaveLength(documentLength(atoms))
  })
})

describe('splitChipLabel', function () {
  it('label 是短路径时按 label 拆两段，完整路径留在 id', function () {
    const chip = buildChip('file', 'client/src/a.ts', 'C:/work/client/src/a.ts')
    expect(splitChipLabel(chip.type, chip.label, chip.id)).toEqual({
      dir: 'client/src/',
      base: 'a.ts'
    })
  })

  it('没有 label 时退回 id', function () {
    expect(splitChipLabel('file', '', 'apps/a.ts')).toEqual({ dir: 'apps/', base: 'a.ts' })
  })

  it('skill 不拆目录段', function () {
    expect(splitChipLabel('skill', 'dingtalk-aitable', 'skill:dingtalk-aitable')).toEqual({
      dir: '',
      base: 'dingtalk-aitable'
    })
  })
})
