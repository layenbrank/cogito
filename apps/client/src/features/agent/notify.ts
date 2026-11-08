/**
 * 系统通知：一轮跑完 / 需要人工确认时提醒用户。
 *
 * 判断依据：
 * - **正看着这个会话** → 不打扰（界面已经有状态，弹窗是噪音）；
 * - **目标推进中** → 每轮结束都不弹，等它整段跑完再说（否则 6 轮弹 6 次）；
 * - **审批** → 一定要报（用户可能在别的窗口，等他点确认才是正事），同会话 60s 内只弹一次。
 */
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'

import { readGoalRun } from '@/features/agent/goal-run'
import { readAgentModeThread } from '@/features/agent/mode'
import { useAgentStore } from '@/stores/agent'

let permission: boolean | null = null

/** 同一会话的审批提醒节流：一轮里可能连着好几个工具都要确认 */
const APPROVAL_THROTTLE_MS = 60_000
const lastApprovalAt = new Map<string, number>()

async function ensurePermission(): Promise<boolean> {
  if (permission !== null) return permission
  try {
    permission = await isPermissionGranted()
    if (!permission) permission = (await requestPermission()) === 'granted'
  } catch (error) {
    console.warn('[agent/notify] 通知权限申请失败:', error)
    permission = false
  }
  return permission
}

function findSessionTitle(threadID: string): string {
  const found = useAgentStore.getState().sessions.find(function (session) {
    return session.id === threadID
  })
  return found?.title?.trim() || 'Cogito 会话'
}

function send(title: string, body: string): void {
  try {
    sendNotification({ title, body })
  } catch (error) {
    console.warn('[agent/notify] 发送系统通知失败:', error)
  }
}

/** 一轮正常跑完（取消 / 出错不算） */
async function notifyTurnDone(
  threadID: string,
  cancelled: boolean,
  body = '执行完成'
): Promise<void> {
  if (cancelled) return
  // 目标推进还会自己跑下一轮，逐轮弹通知是噪音
  if (readGoalRun(threadID)) return
  // 用户就在这个会话里看着，不用提醒
  if (readAgentModeThread() === threadID) return
  if (!(await ensurePermission())) return
  send(findSessionTitle(threadID), body)
}

/** 有工具调用在等人确认 */
async function notifyApproval(threadID: string): Promise<void> {
  const now = Date.now()
  const last = lastApprovalAt.get(threadID) ?? 0
  if (now - last < APPROVAL_THROTTLE_MS) return
  lastApprovalAt.set(threadID, now)
  if (!(await ensurePermission())) return
  send(findSessionTitle(threadID), '有操作等待你确认')
}

/**
 * 定时任务跑完：任务页 / 会话都不在场，**必报**（成功也报，失败更要报）。
 *
 * 与 `notifyTurnDone` 的差别：那条按「用户正看着就闭嘴」节流，这条没有「正看着」的场景 ——
 * 定时任务本来就在后台跑，不弹通知等于静默结束。
 */
async function notifyAutomationRun(
  name: string,
  ok: boolean,
  error: string | null
): Promise<void> {
  if (!(await ensurePermission())) return
  const title = ok ? `任务完成：${name}` : `任务失败：${name}`
  const body = ok
    ? '执行完成，点开任务页看结果'
    : error?.trim() || '执行失败，点开任务页看记录'
  send(title, body)
}

export { notifyApproval, notifyAutomationRun, notifyTurnDone }
