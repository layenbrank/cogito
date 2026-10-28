import { describe, expect, it } from 'vitest'

import { isSamePath, relocatePath } from './path.ts'

describe('isSamePath', function () {
  it('分隔符与大小写不影响判定', function () {
    expect(isSamePath('D:/repo/src/a.ts', 'd:\\repo\\src\\A.ts')).toBe(true)
  })

  it('不同文件判定为不同', function () {
    expect(isSamePath('D:/repo/a.ts', 'D:/repo/b.ts')).toBe(false)
  })
})

describe('relocatePath', function () {
  it('文件自身改名直接返回新路径', function () {
    expect(relocatePath('D:/repo/a.ts', 'D:/repo/a.ts', 'D:/repo/b.ts')).toBe('D:/repo/b.ts')
  })

  it('目录改名时保留子路径', function () {
    expect(relocatePath('D:/repo/src/view/a.ts', 'D:/repo/src', 'D:/repo/lib')).toBe(
      'D:/repo/lib/view/a.ts'
    )
  })

  it('不在改名目录下返回 null', function () {
    expect(relocatePath('D:/repo/other/a.ts', 'D:/repo/src', 'D:/repo/lib')).toBeNull()
  })

  it('大小写不同的同一目录同样迁移', function () {
    expect(relocatePath('D:/Repo/Src/a.ts', 'd:/repo/src', 'D:/repo/lib')).toBe(
      'D:/repo/lib/a.ts'
    )
  })
})
