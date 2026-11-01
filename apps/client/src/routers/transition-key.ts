/**
 * 转场的粒度是**应用页**（带绝对 path 的顶层路由），不是叶路由。
 *
 * `match.id` 由 router 按路由在树上的位置生成。参数变化（`/directive/a` → `/directive/b`）
 * 与同页子路由切换（`/capture` ↔ `/capture/recording`、`/agent/chat` ↔ `/agent/settings`）
 * 都落在同一应用页 id 上，避免 RouteTransition 换 key 把布局壳整树 remount。
 *
 * 应用 ↔ 应用仍换 key（各自绝对 path 不同），进场动效保留。
 */
function findTransitionKey(
  matches: readonly { id: string; route?: { path?: string } }[]
): string {
  for (const match of matches) {
    const path = match.route?.path
    if (path && path.startsWith('/') && path !== '/') {
      return match.id
    }
  }
  const deepest = matches[matches.length - 1]
  return deepest ? deepest.id : '/'
}

export { findTransitionKey }
