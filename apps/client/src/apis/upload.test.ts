import { describe, expect, it } from 'vitest'

import { CHUNK_SIZE, planMissingChunks } from '@/apis/upload.ts'

describe('planMissingChunks', function () {
  it('新建会话（服务端 uploaded 为空）时整份都要传', function () {
    expect(planMissingChunks(1024, [])).toEqual([0])
  })

  it('按分片大小切：多片时序号连续', function () {
    const size = CHUNK_SIZE * 2 + 100
    expect(planMissingChunks(size, [])).toEqual([0, 1, 2])
  })

  it('续传只补缺的片（uploaded 是「已传过」而不是「待传」）', function () {
    const size = CHUNK_SIZE * 3
    expect(planMissingChunks(size, [0, 2])).toEqual([1])
  })

  it('空文件不该有分片（服务端会先拒，这里只保证不越界）', function () {
    expect(planMissingChunks(0, [])).toEqual([])
  })
})
