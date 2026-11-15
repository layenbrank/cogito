import { describe, expect, it } from 'vitest'

import { planDiskUpdate } from '@/views/agent/chat/components/aside-files-disk-update'

describe('磁盘内容变化时缓冲区的处理', function () {
  it('换文件 / 首次挂载：照常建 model', function () {
    expect(
      planDiskUpdate({ isSameFile: false, bufferValue: 'x', savedValue: 'x', diskContent: 'y' })
    ).toBe('create')
    expect(
      planDiskUpdate({ isSameFile: true, bufferValue: null, savedValue: '', diskContent: 'y' })
    ).toBe('create')
  })

  it('缓冲区没有未保存改动：跟着磁盘走', function () {
    expect(
      planDiskUpdate({ isSameFile: true, bufferValue: 'old', savedValue: 'old', diskContent: 'new' })
    ).toBe('follow-disk')
    // 磁盘没变、缓冲区也没动：同样是「跟着磁盘」（force 是 no-op）
    expect(
      planDiskUpdate({ isSameFile: true, bufferValue: 'same', savedValue: 'same', diskContent: 'same' })
    ).toBe('follow-disk')
  })

  it('有未保存改动 + 磁盘也变了：冲突，两边都不动', function () {
    expect(
      planDiskUpdate({ isSameFile: true, bufferValue: 'mine', savedValue: 'old', diskContent: 'new' })
    ).toBe('conflict')
  })

  it('只有本地改动、磁盘没变：保持现状，不算冲突也不覆盖', function () {
    expect(
      planDiskUpdate({ isSameFile: true, bufferValue: 'mine', savedValue: 'old', diskContent: 'old' })
    ).toBe('keep-buffer')
  })
})
