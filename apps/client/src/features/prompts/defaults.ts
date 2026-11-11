import type { SavedPrompt } from './types'

const SEED_TIME = 0

/**
 * 首次打开提示词库时的几条种子。
 *
 * 不写业务黑话：都是「这句话省掉一次手动交代」的模板，变量用 `{name}` 标出来，
 * 插入后停在输入框里由用户补。用户删光之后不会再自动塞回来（见 store 的 hydrate）。
 */
const DEFAULT_PROMPTS: readonly SavedPrompt[] = [
  {
    id: 'seed-review-pr',
    title: '审查 PR',
    body: '对照仓库约定审查 {branch}：先判断这个改动该不该存在，再看实现是否正确。',
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME
  },
  {
    id: 'seed-explain-file',
    title: '解释这个文件',
    body: '解释 {file} 的职责、关键数据流，以及最容易被人误用的地方。',
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME
  },
  {
    id: 'seed-changeset',
    title: '写 changeset',
    body: '为这次改动写一段 changeset：面向使用者说明行为变化，不要罗列文件。',
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME
  },
  {
    id: 'seed-trace-error',
    title: '定位报错',
    body: '按「现象 → 复现 → 根因 → 修复」四段定位这个报错：{error}',
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME
  }
]

export { DEFAULT_PROMPTS }
