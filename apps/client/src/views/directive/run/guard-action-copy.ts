import type { JobKind } from '@/shared/ipc/specs/sidecar'

import type { useGuardRun } from './use-guard-run'

type GuardRun = ReturnType<typeof useGuardRun>

interface GuardCopy {
  icon: string
  label: string
  hint: string
}

function findStopHint(isStopping: boolean, isRunning: boolean, idleHint: string): string {
  if (isStopping) return '已请求停止，等待本次结束'
  if (isRunning) return '当前有任务在跑'
  return idleHint
}

function findAliveMenuCopy(kind: JobKind, guard: GuardRun): GuardCopy {
  const isCron = kind === 'cron'
  const stopping = isCron ? guard.isCronStopping : guard.isWatchStopping
  const running = isCron ? guard.isCronRunning : guard.isWatchRunning
  const name = isCron ? 'cron' : 'watch'
  return {
    icon: stopping ? 'mdi:timer-sand' : 'mdi:stop',
    label: stopping ? `正在停止 ${name}` : `停止 ${name}`,
    hint: findStopHint(stopping, running, isCron ? '结束定时守护' : '结束文件监听')
  }
}

function findIdleMenuCopy(kind: JobKind, hasCap: boolean): GuardCopy {
  if (kind === 'cron') {
    return {
      icon: 'mdi:clock-outline',
      label: '以 cron 守护',
      hint: hasCap ? '按表达式定时触发' : '指令未声明 cron 触发器'
    }
  }
  return {
    icon: 'mdi:eye-outline',
    label: '以 watch 守护',
    hint: hasCap ? '文件变更时触发' : '指令未声明 watch 触发器'
  }
}

function findGuardIcon(kind: JobKind, guard: GuardRun): string {
  const isCron = kind === 'cron'
  const stopping = isCron ? guard.isCronStopping : guard.isWatchStopping
  const alive = isCron ? guard.alive.cron : guard.alive.watch
  if (stopping) return 'mdi:timer-sand'
  if (alive) return 'mdi:stop'
  return isCron ? 'mdi:clock-outline' : 'mdi:eye-outline'
}

function findGuardBarLabel(kind: JobKind, name: string, guard: GuardRun): string {
  const prefix = kind === 'cron' ? 'cron' : 'watch'
  const alive = kind === 'cron' ? guard.alive.cron : guard.alive.watch
  const stopping = kind === 'cron' ? guard.isCronStopping : guard.isWatchStopping
  if (stopping) return `正在停止 ${prefix} · ${name}`
  if (alive) return `停止 ${prefix} · ${name}`
  return `以 ${prefix} 守护 · ${name}`
}

function findGuardBarHint(kind: JobKind, guard: GuardRun): string {
  const alive = kind === 'cron' ? guard.alive.cron : guard.alive.watch
  const stopping = kind === 'cron' ? guard.isCronStopping : guard.isWatchStopping
  if (stopping) return '已请求停止，等待本次结束'
  if (alive) return kind === 'cron' ? '守护中，点击停止' : '监听中，点击停止'
  return kind === 'cron' ? '定时触发' : '文件变更触发'
}

export { findAliveMenuCopy, findIdleMenuCopy, findGuardIcon, findGuardBarLabel, findGuardBarHint }
