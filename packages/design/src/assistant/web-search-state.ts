/**
 * 联网搜索（web-search）的纯函数层：把「来源」规整成元素要的三件事 —— 标题、域名、字母徽章。
 *
 * 为什么单独一层：域名要从 href 里剥（协议 / www. / 端口 / 路径），同一页的多条结果要
 * 去重，徽章要取域名首字母。都是纯映射，跟 React 无关 —— 客户端与服务端渲染共用一套
 * 口径，也方便单测把边界锁住（本地地址、带端口、带账号、中文域名）。
 */

/** 宿主给元素的最小来源：只有标题与链接，域名由本层算 */
interface WebSearchSource {
  title: string
  href: string
}

/** 元素渲染要的结果行：域名拆出来，链接可选（没有链接就不可点） */
interface WebSearchResult {
  title: string
  domain: string
  href?: string
}

/**
 * `https://www.assistant-ui.com/docs/x?y=1` → `assistant-ui.com`
 *
 * 去协议、去 `www.`、去端口、去路径 / 查询 / 锚点，并统一小写 —— 结果行右侧那个
 * 等宽标签只用来看「这是哪个站」，多了 `www.` 就是白占宽度。
 */
function toDomain(href: string): string {
  let rest = href.trim()
  if (!rest) return ''
  const scheme = rest.indexOf('://')
  if (scheme >= 0) rest = rest.slice(scheme + 3)
  if (rest.startsWith('//')) rest = rest.slice(2)
  const stop = rest.search(/[/?#]/)
  if (stop >= 0) rest = rest.slice(0, stop)
  // user:pass@host —— 账号密码不进展示
  const at = rest.lastIndexOf('@')
  if (at >= 0) rest = rest.slice(at + 1)
  // host:port —— 只剥「最后一个冒号在右方括号之后」的那一段，IPv6 的 [::1]:8080 也成立
  const bracket = rest.lastIndexOf(']')
  const colon = rest.lastIndexOf(':')
  if (colon > bracket) rest = rest.slice(0, colon)
  const lower = rest.toLowerCase()
  return lower.startsWith('www.') ? lower.slice(4) : lower
}

/**
 * 徽章字母：域名首个字母数字，大写。
 * 中文域名 / IP 反查不到 ASCII 时给 `·`，不留空格（`size-4` 的方块会塌）。
 */
function toDomainInitial(domain: string): string {
  const match = domain.match(/[a-z0-9]/i)
  return match ? match[0].toUpperCase() : '·'
}

/**
 * 来源列表 → 元素结果行：补域名、按「域名 + 标题」去重、丢掉没有链接的条目。
 *
 * 去重按域名 + 标题而不是只按 href：同一篇文章常被搜索结果给出 `/` 与 `?ref=` 两个
 * 地址，只按 href 去会重复两张一模一样的行。
 */
function toWebSearchResults(sources: readonly WebSearchSource[]): WebSearchResult[] {
  const rows: WebSearchResult[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    const href = source.href.trim()
    if (!href) continue
    const title = source.title.trim() || href
    const domain = toDomain(href)
    const key = domain + '\n' + title
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ title, domain, href })
  }
  return rows
}

export { toDomain, toDomainInitial, toWebSearchResults }
export type { WebSearchResult, WebSearchSource }
