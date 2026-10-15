import { matchRoutes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { routes } from '@/routers/index.tsx'

/** 命中链（根 → 叶）的路由表，用来断言某个 URL 落在哪个布局的哪个子页下 */
function findMatchChain(pathname: string) {
  const matches = matchRoutes(routes, pathname) ?? []
  return matches
    .map(function (match) {
      return match.route
    })
    .filter(function (route) {
      // 顶层是路由转场用的无路径布局路由，不进断言链；index 子路由（无 path）要保留
      return route.path !== undefined || route.index === true
    })
}

describe('agent window routes', function () {
  it('serves chat / settings as children of the /agent layout route', function () {
    expect(
      findMatchChain('/agent/chat').map(function (route) {
        return route.path
      })
    ).toEqual(['/agent', 'chat'])

    expect(
      findMatchChain('/agent/settings').map(function (route) {
        return route.path
      })
    ).toEqual(['/agent', 'settings'])
  })

  it('redirects /agent itself to the default child page', function () {
    const chain = findMatchChain('/agent')
    expect(chain).toHaveLength(2)
    expect(chain[0]?.path).toBe('/agent')
    expect(chain[1]?.index).toBe(true)
  })
})

describe('capture window routes', function () {
  it('serves screenshot index and recording as children of /capture', function () {
    const indexChain = findMatchChain('/capture')
    expect(indexChain[0]?.path).toBe('/capture')
    expect(indexChain[1]?.index).toBe(true)

    expect(
      findMatchChain('/capture/recording').map(function (route) {
        return route.path
      })
    ).toEqual(['/capture', 'recording'])
  })
})
