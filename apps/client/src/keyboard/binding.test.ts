import { describe, expect, it } from 'vitest'

import {
  bindingFromEvent,
  bindingKey,
  bindingKeyOfText,
  bindingLabels,
  findBindingWarnings,
  findConflicts,
  formatBindingText,
  matchesEventText,
  parseBinding,
  toAcceleratorText,
  validateBinding
} from '@/keyboard/binding'
import type { ShortcutBindingEntry } from '@/keyboard/binding'

function event(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('parseBinding', function () {
  it('解析修饰键与主键', function () {
    expect(parseBinding('mod+shift+p')).toEqual({
      mod: true,
      ctrl: false,
      alt: false,
      shift: true,
      meta: false,
      key: 'p'
    })
  })

  it('顺序无关、大小写不敏感', function () {
    expect(parseBinding('Shift+Ctrl+P')).toEqual(parseBinding('ctrl+shift+p'))
  })

  it('接受 Tauri accelerator 的修饰键写法', function () {
    const binding = parseBinding('Control+Alt+Q')
    expect(binding?.ctrl).toBe(true)
    expect(binding?.alt).toBe(true)
    expect(binding?.key).toBe('q')
  })

  it('接受主键别名', function () {
    expect(parseBinding('esc')?.key).toBe('escape')
    expect(parseBinding('ArrowUp')?.key).toBe('arrowup')
    expect(parseBinding('space')?.key).toBe('space')
    expect(parseBinding('mod+shift+8')?.key).toBe('8')
    // 逆向：事件的 `event.key` 是空格字符时也要认出来
    expect(bindingFromEvent(event({ key: ' ', code: 'Space' }))?.key).toBe('space')
  })

  it('没有主键或有两个主键都不合法', function () {
    expect(parseBinding('mod')).toBeNull()
    expect(parseBinding('')).toBeNull()
    expect(parseBinding('a+b')).toBeNull()
    expect(parseBinding('+')).toBeNull()
  })
})

describe('bindingKey', function () {
  it('Windows/Linux 上 mod 就是 ctrl', function () {
    expect(bindingKeyOfText('mod+p', 'other')).toBe('ctrl+p')
    expect(bindingKeyOfText('ctrl+p', 'other')).toBe('ctrl+p')
    expect(bindingKeyOfText('mod+p', 'other')).toBe(bindingKeyOfText('Control+P', 'other'))
  })

  it('mac 上 mod 是 command，与 ctrl 不同', function () {
    expect(bindingKeyOfText('mod+p', 'mac')).toBe('super+p')
    expect(bindingKeyOfText('meta+p', 'mac')).toBe('super+p')
    expect(bindingKeyOfText('ctrl+p', 'mac')).toBe('ctrl+p')
  })

  it('无法解析时返回 null', function () {
    expect(bindingKeyOfText('a+b')).toBeNull()
  })

  it('结构化键位与文本一致', function () {
    expect(bindingKey(parseBinding('alt+q')!, 'other')).toBe('alt+q')
  })
})

describe('formatBinding', function () {
  it('非 mac 用带加号的缩写', function () {
    expect(formatBindingText('mod+shift+p', 'other')).toBe('Ctrl+Shift+P')
  })

  it('mac 用符号', function () {
    expect(bindingLabels(parseBinding('mod+shift+p')!, 'mac')).toEqual(['⌘', '⇧', 'P'])
  })

  it('mac 上 mod 与 meta 不会画两遍', function () {
    expect(bindingLabels(parseBinding('mod+meta+l')!, 'mac')).toEqual(['⌘', 'L'])
  })

  it('特殊主键有人话写法', function () {
    expect(formatBindingText('escape', 'other')).toBe('Esc')
    expect(formatBindingText('mod+arrowup', 'other')).toBe('Ctrl+↑')
  })

  it('脏数据原样返回', function () {
    expect(formatBindingText('a+b', 'other')).toBe('a+b')
  })
})

describe('toAcceleratorText', function () {
  it('转成 Tauri 写法', function () {
    expect(toAcceleratorText('alt+q', 'other')).toBe('Alt+Q')
    expect(toAcceleratorText('mod+shift+p', 'other')).toBe('Control+Shift+P')
    expect(toAcceleratorText('escape', 'other')).toBe('Esc')
    expect(toAcceleratorText('mod+shift+8', 'other')).toBe('Control+Shift+8')
  })

  it('mac 上 mod 落到 Super', function () {
    expect(toAcceleratorText('mod+p', 'mac')).toBe('Super+P')
  })

  it('无法解析时返回 null', function () {
    expect(toAcceleratorText('a+b', 'other')).toBeNull()
  })
})

describe('bindingFromEvent', function () {
  it('只按修饰键时返回 null', function () {
    expect(bindingFromEvent(event({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))).toBeNull()
    expect(bindingFromEvent(event({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toBeNull()
  })

  it('用物理键采集，Shift+8 得到主键 8 而不是字符 *', function () {
    const binding = bindingFromEvent(
      event({ key: '*', code: 'Digit8', shiftKey: true, ctrlKey: true })
    )
    expect(binding?.key).toBe('8')
    expect(binding?.shift).toBe(true)
  })

  it('字母键大小写归一', function () {
    expect(bindingFromEvent(event({ key: 'Q', code: 'KeyQ', altKey: true }))?.key).toBe('q')
  })
})

describe('matchesEventText', function () {
  it('mod 在非 mac 匹配 ctrl', function () {
    expect(
      matchesEventText('mod+s', event({ key: 's', code: 'KeyS', ctrlKey: true }), 'other')
    ).toBe(true)
    expect(
      matchesEventText('mod+s', event({ key: 's', code: 'KeyS', metaKey: true }), 'other')
    ).toBe(false)
  })

  it('mac 上 mod 匹配 command', function () {
    expect(
      matchesEventText('mod+s', event({ key: 's', code: 'KeyS', metaKey: true }), 'mac')
    ).toBe(true)
    expect(
      matchesEventText('mod+s', event({ key: 's', code: 'KeyS', ctrlKey: true }), 'mac')
    ).toBe(false)
  })

  it('修饰键必须完全一致，多按一个不命中', function () {
    expect(
      matchesEventText('mod+s', event({ key: 's', code: 'KeyS', ctrlKey: true, shiftKey: true }))
    ).toBe(false)
  })

  it('mod+shift+8 在美式键盘上按 * 也命中', function () {
    const pressed = event({ key: '*', code: 'Digit8', shiftKey: true, ctrlKey: true })
    expect(matchesEventText('mod+shift+8', pressed, 'other')).toBe(true)
  })

  it('裸键也能匹配', function () {
    expect(matchesEventText('escape', event({ key: 'Escape', code: 'Escape' }))).toBe(true)
  })
})

describe('validateBinding', function () {
  it('局部键允许裸键', function () {
    expect(validateBinding('escape', 'app')).toBeNull()
    expect(validateBinding('space', 'app')).toBeNull()
    expect(validateBinding('s', 'view')).toBeNull()
    expect(validateBinding('mod+shift+p', 'view')).toBeNull()
  })

  it('全局键必须有修饰键', function () {
    expect(validateBinding('escape', 'global')).toBe('全局快捷键至少需要一个修饰键')
    expect(validateBinding('q', 'global')).toBe('全局快捷键至少需要一个修饰键')
  })

  it('全局键禁止 mod', function () {
    expect(validateBinding('mod+q', 'global')).toBe('全局快捷键不能用 mod，请明确写 Control 或 Super')
  })

  it('全局键接受显式修饰键', function () {
    expect(validateBinding('Alt+Q', 'global')).toBeNull()
    expect(validateBinding('Control+Alt+Q', 'global')).toBeNull()
  })

  it('空值与垃圾值', function () {
    expect(validateBinding('   ', 'app')).toBe('请按下快捷键')
    expect(validateBinding('a+b', 'app')).toBe('无法识别的快捷键')
  })
})

describe('findBindingWarnings', function () {
  it('只用 Ctrl 的全局键给软提示', function () {
    expect(findBindingWarnings('Control+Q', 'global')).toHaveLength(1)
  })

  it('带 Alt/Super 就不提示', function () {
    expect(findBindingWarnings('Alt+Q', 'global')).toHaveLength(0)
    expect(findBindingWarnings('Super+Q', 'global')).toHaveLength(0)
  })

  it('局部键不提示', function () {
    expect(findBindingWarnings('mod+s', 'view')).toHaveLength(0)
  })
})

describe('findConflicts', function () {
  function entry(
    id: string,
    scope: ShortcutBindingEntry['scope'],
    binding: string,
    window?: ShortcutBindingEntry['window']
  ): ShortcutBindingEntry {
    return { id, title: id, scope, binding, window }
  }

  it('全局键互相重复 → 阻断', function () {
    const conflicts = findConflicts(
      [entry('a', 'global', 'Alt+Q'), entry('b', 'global', 'Alt+Q')],
      'other'
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].severity).toBe('block')
  })

  it('全局键与窗口内键同组合 → 阻断（前台双触发）', function () {
    const conflicts = findConflicts(
      [entry('a', 'global', 'Alt+Q'), entry('b', 'view', 'alt+q', 'main')],
      'other'
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].severity).toBe('block')
    expect(conflicts[0].message).toContain('触发两次')
  })

  it('同窗口同作用域的局部键重复 → 阻断', function () {
    const conflicts = findConflicts(
      [entry('a', 'editor', 'mod+shift+e', 'main'), entry('b', 'editor', 'mod+shift+e', 'main')],
      'other'
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].severity).toBe('block')
  })

  it('不同窗口同组合不冲突', function () {
    expect(
      findConflicts(
        [entry('a', 'app', 'escape', 'main'), entry('b', 'app', 'escape', 'overlay')],
        'other'
      )
    ).toHaveLength(0)
  })

  it('视图之间重复不报告（路由互斥）', function () {
    expect(
      findConflicts(
        [
          entry('code.save', 'view', 'mod+s', 'main'),
          entry('knowledge.save', 'view', 'mod+s', 'main')
        ],
        'other'
      )
    ).toHaveLength(0)
  })

  it('视图级与编辑器级重复不报告（两边不同时在场）', function () {
    expect(
      findConflicts(
        [
          entry('clipchamp.undo', 'view', 'mod+z', 'main'),
          entry('editor.undo', 'editor', 'mod+z', 'main')
        ],
        'other'
      )
    ).toHaveLength(0)
  })

  it('编辑器内互相重复 → 阻断（同一个编辑器里两个扩展都注册）', function () {
    const conflicts = findConflicts(
      [
        entry('editor.emojiTrigger', 'editor', 'mod+shift+e', 'main'),
        entry('editor.imageAlignCenter', 'editor', 'mod+shift+e', 'main')
      ],
      'other'
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].severity).toBe('block')
  })

  it('app 级被 view 级覆盖只提示', function () {
    const conflicts = findConflicts(
      [entry('app.save', 'app', 'mod+s', 'main'), entry('code.save', 'view', 'mod+s', 'main')],
      'other'
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].severity).toBe('warn')
  })

  it('mod 与显式 ctrl 会被识别成同一个键', function () {
    const conflicts = findConflicts(
      [entry('a', 'editor', 'mod+b', 'main'), entry('b', 'editor', 'ctrl+b', 'main')],
      'other'
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].severity).toBe('block')
  })

  it('mac 上 mod 与 ctrl 是两个键，不冲突', function () {
    expect(
      findConflicts(
        [entry('a', 'editor', 'mod+b', 'main'), entry('b', 'editor', 'ctrl+b', 'main')],
        'mac'
      )
    ).toHaveLength(0)
  })

  it('无法解析的键位被跳过', function () {
    expect(findConflicts([entry('a', 'view', 'a+b'), entry('b', 'view', 'a+b')])).toHaveLength(0)
  })
})
