/** 一条用户保存的提示词模板。`body` 里的 `{name}` 是待填变量。 */
interface SavedPrompt {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type { SavedPrompt }
