import { isArticle, isSnapshot, readArticleExtract, readPageSnapshot } from '@/features/capture/snapshot.ts'
import { findPortOrder, notifyExtension, rememberPort } from '@/features/relay/session.ts'
import {
  MESSAGE_CLIP_ACTIVE,
  MESSAGE_CLIP_PAGE,
  MESSAGE_EXTERNAL_CLIP,
  MESSAGE_EXTRACT,
  MESSAGE_HEALTH
} from '@/protocol/constants.ts'
import { deliverClip, orderPorts, probeClient } from '@/protocol/client.ts'
import { composeMarkdown } from '@/protocol/markdown.ts'
import { isRecord, parsePayload } from '@/protocol/payload.ts'

import type { ClipDelivery } from '@/protocol/payload.ts'

const MISSING_TAB = '没有活动标签页'

async function findActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]
  return typeof tab?.id === 'number' ? tab.id : null
}

async function clipSnapshot(): Promise<ClipDelivery> {
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
    console.error('[clipper] 提取失败', error)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  if (!isSnapshot(snapshot)) return { ok: false, error: MISSING_TAB }

  const markdown = composeMarkdown(snapshot.title, snapshot.url, snapshot.text, new Date().toISOString())
  const ports = await findPortOrder()
  const delivery = await deliverClip(
    { title: snapshot.title, url: snapshot.url, markdown },
    ports
  )
  if (delivery.ok && typeof delivery.port === 'number') {
    await rememberPort(delivery.port)
    await notifyExtension(delivery)
  }
  return delivery
}

async function postPayload(message: unknown): Promise<ClipDelivery> {
  const payload = isRecord(message) ? parsePayload(message.payload) : null
  if (!payload) return { ok: false, error: 'invalid payload' }
  const ports = await findPortOrder()
  const delivery = await deliverClip(payload, ports)
  if (delivery.ok && typeof delivery.port === 'number') {
    await rememberPort(delivery.port)
    await notifyExtension(delivery)
  }
  return delivery
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
    console.error('[clipper] 抽取正文失败', error)
    return { title: '', url: '', markdown: '' }
  }
}

async function runMessage(message: unknown): Promise<unknown> {
  if (!isRecord(message) || typeof message.type !== 'string') return undefined

  if (message.type === MESSAGE_CLIP_PAGE) return postPayload(message)
  if (message.type === MESSAGE_CLIP_ACTIVE || message.type === MESSAGE_EXTERNAL_CLIP) return clipSnapshot()
  if (message.type === MESSAGE_EXTRACT) return extractArticle()
  if (message.type === MESSAGE_HEALTH) {
    const ports = await findPortOrder()
    const health = await probeClient(ports)
    return health ?? { ok: false, error: 'client unreachable', ports: orderPorts(null) }
  }
  return undefined
}

function handleMessage(message: unknown, sendResponse: (response: unknown) => void): boolean {
  if (!isRecord(message) || typeof message.type !== 'string') return false
  const known =
    message.type === MESSAGE_CLIP_PAGE ||
    message.type === MESSAGE_CLIP_ACTIVE ||
    message.type === MESSAGE_EXTERNAL_CLIP ||
    message.type === MESSAGE_EXTRACT ||
    message.type === MESSAGE_HEALTH
  if (!known) return false

  void runMessage(message)
    .then(function (response) {
      sendResponse(response)
    })
    .catch(function (error: unknown) {
      console.error('[clipper] 消息处理失败', error)
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    })
  return true
}

export { handleMessage }
