/**
 * 工作区内容版本号：分支切换 / 外部改动后，通知所有「读工作区」的面板重拉。
 *
 * 文件树、审阅、提交历史、文件预览读的都是磁盘现状，分支一换内容就变了；
 * 它们各自拉数据、各自缓存，所以需要一个统一的失效信号。
 */
const listeners = new Set<() => void>()

import { useSyncExternalStore } from 'react'

let revision = 0

function readWorkspaceRevision(): number {
  return revision
}

function subscribeWorkspaceRevision(listener: () => void): () => void {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

/** 分支切换、拉取后调用：让所有订阅方重拉一次 */
function bumpWorkspaceRevision() {
  revision += 1
  for (const listener of [...listeners]) listener()
}

/** 面板侧订阅：返回当前版本号，变化时组件会重渲并由 effect 重拉 */
function useWorkspaceRevision(): number {
  return useSyncExternalStore(
    subscribeWorkspaceRevision,
    readWorkspaceRevision,
    readWorkspaceRevision
  )
}

export {
  bumpWorkspaceRevision,
  readWorkspaceRevision,
  subscribeWorkspaceRevision,
  useWorkspaceRevision
}
