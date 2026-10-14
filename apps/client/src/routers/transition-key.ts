/**
 * 转场的粒度是**路由**，不是整条路径。`match.id` 由 router 按路由在树上的位置生成
 * （与参数无关），于是 `/directive/a` → `/directive/b` 这种「同一页面的参数变化」不会重挂页面。
 */
function findTransitionKey(matches: readonly { id: string }[]): string {
  const deepest = matches[matches.length - 1]
  return deepest ? deepest.id : '/'
}

export { findTransitionKey }
