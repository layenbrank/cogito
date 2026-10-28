/**
 * 磁贴内 AI 对话坞：所有磁贴共用一个组件，各自 register 自己的 scope。
 */
export { AgentDock } from './dock'
export { useDockStore } from './store'
export type { DockAction, DockScope } from './types'
