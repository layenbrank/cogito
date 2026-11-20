/**
 * service worker 里要装的那一半：收页面发来的剪藏请求，注入抽取函数并投递到本机 client。
 *
 * 为什么不自己带一个 `background.service_worker`：MV3 一个扩展只能注册一个 worker。
 * 所以这里只导出 `installClipRelay()`，由打包者（`apps/extension/src/entries/worker.ts`）
 * 在 worker 顶层把自己的右键菜单与它一起装上 —— 监听器**必须**在模块顶层同步注册，
 * 否则 MV3 唤醒 worker 时事件可能先到、被丢掉。
 */
import { deliverClip, probeClient } from './client.ts'
import {
  MESSAGE_CLIP_ACTIVE,
  MESSAGE_CLIP_PAGE,
  MESSAGE_EXTRACT,
  MESSAGE_HEALTH
} from './constants.ts'
import { isArticle, isSnapshot, readArticleExtract, readPageSnapshot } from './extract.ts'
import { composeMarkdown } from './markdown.ts'
import { isRecord, parsePayload, readMessageType } from './payload.ts'
import { findPortOrder, rememberPort } from './ports.ts'

import type { ClipDelivery } from './payload.ts'

/** 最近一次投递结果：弹窗/页面打开时靠它显示「上次剪藏怎么样了」 */
const STORAGE_CLIP_DELIVERY = 'cogito.clip.delivery'

const MISSING_TAB = '没有活动标签页'

const HANDLED: ReadonlySet<string> = new Set([
  MESSAGE_CLIP_ACTIVE,
  MESSAGE_CLIP_PAGE,
  MESSAGE_EXTRACT,
  MESSAGE_HEALTH
])

async function findActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]
  return typeof tab?.id === 'number' ? tab.id : null
}

async function rememberDelivery(delivery: ClipDelivery): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_CLIP_DELIVERY]: delivery })
  } catch (error) {
    console.error('[clip] 记录剪藏结果失败', error)
  }
}

async function deliver(payload: Parameters<typeof deliverClip>[0]): Promise<ClipDelivery> {
  const ports = await findPortOrder()
  const delivery = await deliverClip(payload, ports)
  if (delivery.ok && typeof delivery.port === 'number') await rememberPort(delivery.port)
  await rememberDelivery(delivery)
  return delivery
}

/** 抽取当前激活标签并投递（弹窗按钮走这条） */
async function clipActiveTab(): Promise<ClipDelivery> {
  const tabId = await findActiveTabId()
  if (tabId === null) return { ok: false, error: MISSING_TAB }

  let snapshot: unknown
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: readPageSnapshot
    })
    snapshot = injected[0]?.result
  } catch (error) {
    console.error('[clip] 提取失败', error)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  if (!isSnapshot(snapshot)) return { ok: false, error: MISSING_TAB }

  return deliver({
    title: snapshot.title,
    url: snapshot.url,
    markdown: composeMarkdown(snapshot.title, snapshot.url, snapshot.text, new Date().toISOString())
  })
}

async function postPayload(message: Record<string, unknown>): Promise<ClipDelivery> {
  const payload = parsePayload(message.payload)
  if (!payload) return { ok: false, error: 'invalid payload' }
  return deliver(payload)
}

async function extractArticle(): Promise<unknown> {
  const tabId = await findActiveTabId()
  if (tabId === null) return { title: '', url: '', markdown: '' }
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: readArticleExtract
    })
    const article = injected[0]?.result
    if (isArticle(article)) return article
    return { title: '', url: '', markdown: '' }
  } catch (error) {
    console.error('[clip] 抽取正文失败', error)
    return { title: '', url: '', markdown: '' }
  }
}

async function runMessage(message: unknown): Promise<unknown> {
  const type = readMessageType(message)
  if (!type || !isRecord(message)) return undefined

  if (type === MESSAGE_CLIP_PAGE) return postPayload(message)
  if (type === MESSAGE_CLIP_ACTIVE) return clipActiveTab()
  if (type === MESSAGE_EXTRACT) return extractArticle()
  if (type === MESSAGE_HEALTH) {
    const ports = await findPortOrder()
    return probeClient(ports)
  }
  return undefined
}

/** 在 worker 顶层调用一次：注册页面 → worker 的消息通道 */
function installClipRelay(): void {
  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    const type = readMessageType(message)
    if (!type || !HANDLED.has(type)) return false
    void runMessage(message)
      .then(function (response) {
        sendResponse(response)
      })
      .catch(function (error: unknown) {
        console.error('[clip] 消息处理失败', error)
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    return true
  })
}

export { STORAGE_CLIP_DELIVERY, clipActiveTab, installClipRelay }
