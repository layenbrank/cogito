/**
 * 打包产物冒烟：用真实浏览器加载 `dist`，验证 MV3 能装起来、service worker 能注册、
 * 页面能渲染（覆盖 manifest 里 hash 文件名的重写结果）。
 *
 *   pnpm --filter @cogito/extension run build
 *   pnpm --filter @cogito/extension run smoke:dist
 *
 * 截图写到系统临时目录 `cogito-smoke`。
 */
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  chromium,
  type BrowserContext,
  type Page,
  type Worker
} from '@playwright/test'

const DIST = resolve(import.meta.dirname, '..', 'dist')
const OUT = join(tmpdir(), 'cogito-smoke')
// 每次用新 profile：复用同一个目录时上一次残留的 Chromium 会锁住它，启动直接超时
const PROFILE = join(OUT, `profile-${Date.now()}`)

const ARGS = [
  `--disable-extensions-except=${DIST}`,
  `--load-extension=${DIST}`,
  // Chrome 137+ 默认忽略 --load-extension，需显式关掉拦截开关
  '--disable-features=DisableLoadExtensionCommandLineSwitch'
]

/** headless shell 不支持扩展，必须用完整浏览器；两者都没装就直接报错 */
const CANDIDATES: { label: string; channel: 'chromium' | 'chrome' }[] = [
  { label: 'chromium', channel: 'chromium' },
  { label: 'chrome', channel: 'chrome' }
]

interface PageState {
  url: string
  title: string
  hasMain: boolean
  tiles: string[]
  hasAddButton: boolean
}

interface SmokeResult {
  browser: string
  serviceWorker: string | null
  page: PageState | null
  newtabHash: string | null
  errors: string[]
}

if (!existsSync(join(DIST, 'manifest.json'))) {
  throw new Error(`dist 未构建：${DIST}（先跑 build）`)
}

await mkdir(OUT, { recursive: true })

async function launch(): Promise<{ context: BrowserContext; browser: string }> {
  for (const candidate of CANDIDATES) {
    try {
      const context = await chromium.launchPersistentContext(PROFILE, {
        channel: candidate.channel,
        headless: true,
        timeout: 30_000,
        args: ARGS
      })
      return { context, browser: candidate.label }
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
      console.log(`[skip] ${candidate.label}: ${message}`)
    }
  }

  throw new Error('没有可用的完整浏览器（需要 channel: chromium 或 chrome）')
}

async function findWorker(context: BrowserContext): Promise<Worker | null> {
  const [existing] = context.serviceWorkers()
  if (existing) return existing

  return context.waitForEvent('serviceworker', { timeout: 15_000 }).catch(() => null)
}

async function readPage(page: Page): Promise<PageState> {
  return page.evaluate(() => ({
    url: location.href,
    title: document.title,
    hasMain: Boolean(document.querySelector('main')),
    tiles: Array.from(document.querySelectorAll('main button'))
      .map((item) => (item.textContent ?? '').trim())
      .filter(Boolean),
    hasAddButton: Array.from(document.querySelectorAll('button')).some((item) =>
      (item.textContent ?? '').includes('添加磁贴')
    )
  }))
}

const { context, browser } = await launch()
const result: SmokeResult = {
  browser,
  serviceWorker: null,
  page: null,
  newtabHash: null,
  errors: []
}

const worker = await findWorker(context)
const extensionID = worker ? new URL(worker.url()).host : null
result.serviceWorker = worker ? worker.url() : null

if (!extensionID) {
  result.errors.push('service worker 未注册（manifest 的 background.service_worker 可能失效）')
} else {
  const page = await context.newPage()
  page.on('pageerror', (error) => result.errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') result.errors.push(`console: ${message.text()}`)
  })

  await page.goto(`chrome-extension://${extensionID}/index.html#/overview`, { waitUntil: 'load' })
  await page.waitForTimeout(1500)
  result.page = await readPage(page)
  await page.screenshot({ path: join(OUT, 'extension-light.png') })

  // 扩展页自身没有主题开关，这里手动加 .dark 验证 token 层没被写死的颜色破坏
  await page.evaluate(() => {
    document.documentElement.classList.add('dark')
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, 'extension-dark.png') })

  // 未带 hash 时路由应重定向到 /overview
  await page.goto(`chrome-extension://${extensionID}/index.html`, { waitUntil: 'load' })
  await page.waitForTimeout(800)
  result.newtabHash = await page.evaluate(() => location.hash)
}

console.log(JSON.stringify(result, null, 2))
console.log(`截图目录：${OUT}`)

await context.close()
process.exit(result.errors.length > 0 ? 2 : 0)
