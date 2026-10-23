/**
 * 登录品牌栏的入场节奏。
 *
 * 首次打开做一次完整的品牌亮相（光丝落位 + 接缝光收放），
 * 同一会话内后续打开只做快速落位，避免每次登录都被同一段动效拦一下。
 */

const FIRST_MS = 620
const REPEAT_MS = 260

let hasPlayedIntro = false

/** 本次打开应使用的入场时长（ms） */
function introDurationMs(): number {
  return hasPlayedIntro ? REPEAT_MS : FIRST_MS
}

/** 标记首次亮相已播过；由打开方在挂载时调用 */
function markIntroPlayed(): void {
  hasPlayedIntro = true
}

export { introDurationMs, markIntroPlayed }
