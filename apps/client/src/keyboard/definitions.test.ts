import { describe, expect, it } from 'vitest'

import { parseBinding, validateBinding } from '@/keyboard/binding'
import { SHORTCUTS, findShortcutConflicts } from '@/keyboard/definitions'

/**
 * 对**表本身**的守卫。
 *
 * 键位表是全应用单源，加错一条（id 重名、键位写错、撞车）会让设置页与派发器一起出错 ——
 * 这里用几条廉价断言把这类错误挡在提交前。
 */
describe('键位表', function () {
  it('没有阻断级冲突', function () {
    const blocks = findShortcutConflicts().filter(function (conflict) {
      return conflict.severity === 'block'
    })
    expect(blocks).toEqual([])
  })

  it('id 唯一', function () {
    const ids = SHORTCUTS.map(function (shortcut) {
      return shortcut.id
    })
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每条默认键位都能解析', function () {
    for (const shortcut of SHORTCUTS) {
      expect(parseBinding(shortcut.defaultBinding), shortcut.id).not.toBeNull()
      if (shortcut.scope !== 'global') {
        for (const extra of shortcut.extraBindings ?? []) {
          expect(parseBinding(extra), `${shortcut.id} 的次要键位 ${extra}`).not.toBeNull()
        }
      }
    }
  })

  it('全局键都过了全局校验，且带备用链', function () {
    for (const shortcut of SHORTCUTS) {
      if (shortcut.scope !== 'global') continue
      expect(validateBinding(shortcut.defaultBinding, 'global'), shortcut.id).toBeNull()
      expect(shortcut.fallbacks.length, shortcut.id).toBeGreaterThan(0)
      for (const fallback of shortcut.fallbacks) {
        expect(validateBinding(fallback, 'global'), `${shortcut.id} 的备用键 ${fallback}`).toBeNull()
      }
    }
  })

  it('标题都不为空', function () {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.title.length, shortcut.id).toBeGreaterThan(0)
    }
  })
})
