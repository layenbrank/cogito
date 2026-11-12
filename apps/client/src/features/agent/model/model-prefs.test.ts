/**
 * 思考档位的**写入顺序契约**。
 *
 * 右栏「立即下发」的写法是 `await writeModelThinking(...)` 之后再让 `applyGooseThinking`
 * 去读 `findModelPref`：读的是内存 cache，写完一个 tick 才落进去，推给 goose 的就会是**上一档**
 * ——界面写着「深入」、模型收到的却是「标准」。这种错位在真机上几乎抓不到，所以在这里钉住两条：
 * 1. 广播之前，新值必须已经能从 `findModelPref` 读到（订阅者收到的回调里读到的就是新值）；
 * 2. `writeModelThinking` 的 Promise 结束后，任何读者都能读到新值。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { resetPersistForTests } from '@/features/persist'

import { findModelPref, subscribeModelPrefs, writeModelPrefs, writeModelThinking } from './model-prefs'

describe('model-prefs 广播', function () {
  beforeEach(function () {
    resetPersistForTests()
  })

  it('广播时新值已经在 cache 里：订阅回调读到的不是旧值', async function () {
    const seen: string[] = []
    const off = subscribeModelPrefs(function () {
      seen.push(findModelPref('p1', 'claude-sonnet-4-5').thinking)
    })
    await writeModelThinking('p1', 'claude-sonnet-4-5', 'max')
    off()
    expect(seen).toEqual(['max'])
  })

  it('写完 await 之后任何读者都能读到新值', async function () {
    await writeModelThinking('p1', 'claude-sonnet-4-5', 'high')
    expect(findModelPref('p1', 'claude-sonnet-4-5').thinking).toBe('high')
    // 换模型不串味：另一个模型仍是默认档
    expect(findModelPref('p1', 'gpt-5').thinking).toBe('medium')
  })

  it('取消订阅后不再收到通知', async function () {
    let hits = 0
    const off = subscribeModelPrefs(function () {
      hits += 1
    })
    await writeModelThinking('p1', 'm1', 'low')
    off()
    await writeModelThinking('p1', 'm1', 'off')
    expect(hits).toBe(1)
  })

  it('设置弹窗那条路（writeModelPrefs）也会广播', async function () {
    let hits = 0
    const off = subscribeModelPrefs(function () {
      hits += 1
    })
    await writeModelPrefs({})
    off()
    expect(hits).toBe(1)
  })
})
