/**
 * 从工具卡等线程外区域打开右栏「审阅」并可选聚焦文件。
 * 由 `AgentAside` 订阅；避免把 aside 状态塞进 tool-card props。
 */

const AGENT_OPEN_ASIDE_REVIEW = 'agent:open-aside-review'

interface AsideReviewDetail {
  relative?: string | null
}

function openAsideReview(relative?: string | null) {
  window.dispatchEvent(
    new CustomEvent<AsideReviewDetail>(AGENT_OPEN_ASIDE_REVIEW, {
      detail: { relative: relative ?? null }
    })
  )
}

function subscribeAsideReview(handler: (detail: AsideReviewDetail) => void): () => void {
  function onEvent(event: Event) {
    const custom = event as CustomEvent<AsideReviewDetail>
    handler(custom.detail ?? {})
  }
  window.addEventListener(AGENT_OPEN_ASIDE_REVIEW, onEvent)
  return function () {
    window.removeEventListener(AGENT_OPEN_ASIDE_REVIEW, onEvent)
  }
}

export { AGENT_OPEN_ASIDE_REVIEW, openAsideReview, subscribeAsideReview }
export type { AsideReviewDetail }
