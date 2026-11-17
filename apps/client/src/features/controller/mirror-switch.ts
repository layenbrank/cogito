/**
 * Mirror 切换请求注册表
 * Pager 调用 requestMirrorSwitch；Controller.Mirror 注册实际切换逻辑
 */
import { useMirrorStore } from '@/stores/mirror'

type MirrorSwitchHandler = (id: string) => Promise<void>

/**
 * 切换闸门的兜底超时：处理函数卡住（退场动画未完成 / 后端无响应）时也要放开闸门，
 * 否则「切换中」的忙碌态会永久滞留，标题栏的镜像入口就再也点不动了。
 */
const SWITCH_TIMEOUT_MS = 6000

let handler: MirrorSwitchHandler | null = null
let isSwitching = false
const switchingListeners = new Set<() => void>()

function notifySwitching() {
  for (const listener of switchingListeners) listener()
}

function registerMirrorSwitch(next: MirrorSwitchHandler) {
  handler = next
  return function () {
    if (handler === next) handler = null
  }
}

async function requestMirrorSwitch(id: string) {
  if (!id || isSwitching) return
  isSwitching = true
  notifySwitching()

  let timer = 0
  try {
    if (!handler) {
      // 没有动画通道（墙还没挂上 / 不在工作台路由）：仍然要把切换做完。
      // 以前这里直接 return，界面上的表现就是「点了没反应」。
      const store = useMirrorStore.getState()
      const payload = await store.toFetchMirrorPayload(id)
      if (payload) store.toCommitMirrorPayload(payload)
      return
    }
    await Promise.race([
      handler(id),
      new Promise<void>(function (resolve) {
        timer = window.setTimeout(function () {
          console.warn('[mirror-switch] 切换超时，已放开闸门')
          resolve()
        }, SWITCH_TIMEOUT_MS)
      })
    ])
  } finally {
    window.clearTimeout(timer)
    isSwitching = false
    notifySwitching()
  }
}

function findIsMirrorSwitching() {
  return isSwitching
}

function subscribeMirrorSwitching(listener: () => void) {
  switchingListeners.add(listener)
  return function () {
    switchingListeners.delete(listener)
  }
}

export {
  registerMirrorSwitch,
  requestMirrorSwitch,
  findIsMirrorSwitching,
  subscribeMirrorSwitching
}
