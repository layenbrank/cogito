import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_PROMPTS } from './defaults'
import {
  createPrompt,
  deletePrompt,
  deriveTitle,
  ensurePrompts,
  getPromptsSnapshot,
  normalizePrompts,
  resetPromptsForTests,
  updatePrompt
} from './store'

describe('prompt store normalize', function () {
  it('drops rows without id or body', function () {
    const rows = normalizePrompts([
      { id: 'a', body: ' keep me ' },
      { id: '', body: 'no id' },
      { id: 'b', body: '   ' },
      null,
      'nope'
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('a')
    expect(rows[0]?.body).toBe('keep me')
  })

  it('dedupes ids and falls back to the first line as title', function () {
    const rows = normalizePrompts([
      { id: 'a', title: '', body: '第一行\n第二行' },
      { id: 'a', body: '重复的 id' }
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('第一行')
  })

  it('returns an empty list for non-array payloads', function () {
    expect(normalizePrompts(null)).toEqual([])
    expect(normalizePrompts({ value: [] })).toEqual([])
  })
})

describe('prompt store deriveTitle', function () {
  it('caps long first lines and keeps a fallback', function () {
    expect(deriveTitle('')).toBe('未命名提示词')
    const long = 'x'.repeat(60)
    expect(deriveTitle(long).endsWith('…')).toBe(true)
    expect(deriveTitle(long).length).toBe(41)
  })
})

describe('prompt store (memory)', function () {
  beforeEach(function () {
    resetPromptsForTests([])
  })

  it('seeds defaults when nothing was saved', async function () {
    resetPromptsForTests()
    await ensurePrompts()
    expect(getPromptsSnapshot().map((row) => row.id)).toEqual(
      DEFAULT_PROMPTS.map((row) => row.id)
    )
  })

  it('creates, updates and deletes a prompt', async function () {
    const created = await createPrompt({ body: '审查 {branch} 的改动' })
    expect(created?.id).toBeTruthy()
    expect(created?.title).toBe('审查 {branch} 的改动')
    expect(getPromptsSnapshot()).toHaveLength(1)

    const updated = await updatePrompt(created!.id, { title: '审查 PR', body: '审查 {branch}' })
    expect(updated?.title).toBe('审查 PR')
    expect(updated?.body).toBe('审查 {branch}')

    expect(await deletePrompt(created!.id)).toBe(true)
    expect(getPromptsSnapshot()).toHaveLength(0)
    expect(await deletePrompt(created!.id)).toBe(false)
  })

  it('rejects empty bodies', async function () {
    expect(await createPrompt({ body: '   ' })).toBeNull()
  })

  it('sorts the snapshot by updatedAt desc', async function () {
    resetPromptsForTests([
      { id: 'old', title: 'old', body: 'a', createdAt: 1, updatedAt: 1 },
      { id: 'new', title: 'new', body: 'b', createdAt: 2, updatedAt: 2 }
    ])
    expect(getPromptsSnapshot().map((row) => row.id)).toEqual(['new', 'old'])
  })
})
