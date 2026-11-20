import {
  CLIP_PORTS,
  MESSAGE_CLIP_ACTIVE,
  STORAGE_CLIP_DELIVERY,
  formatDelivery,
  parseDelivery,
  probeClient
} from '@cogito/extension-kit'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'

import type { ClientHealth, ClipDelivery } from '@cogito/extension-kit'

/**
 * 工具栏弹窗：剪藏当前页到本机知识库。
 *
 * 合并成一个扩展后不再需要「填写对方扩展 ID」——页面抽取与投递都在本扩展的
 * service worker 里（见 `@cogito/extension-kit/relay`），这里只发一条内部消息，
 * 再读回 worker 落库的上次结果。
 */
function PopupSurface() {
  const [health, setHealth] = useState<ClientHealth | null>(null)
  const [delivery, setDelivery] = useState<ClipDelivery | null>(null)
  const [isClipping, setClipping] = useState(false)
  const [status, setStatus] = useState('')

  async function refreshClient(): Promise<void> {
    const next = await probeClient(CLIP_PORTS)
    setHealth(next)
  }

  useEffect(function () {
    void refreshClient()
    // 上次结果由 worker 落库，弹窗每次打开都复述一遍
    void chrome.storage.local
      .get(STORAGE_CLIP_DELIVERY)
      .then(function (bag) {
        const stored = bag[STORAGE_CLIP_DELIVERY]
        if (stored) setDelivery(parseDelivery(stored))
      })
      .catch(function (error: unknown) {
        console.error('[clip] 读取上次剪藏失败', error)
      })
  }, [])

  function onClip(): void {
    setClipping(true)
    setStatus('提取中…')
    chrome.runtime.sendMessage({ type: MESSAGE_CLIP_ACTIVE }, function (response: unknown) {
      const lastError = chrome.runtime.lastError
      if (lastError) {
        console.error('[clip] 剪藏失败', lastError)
        setStatus(lastError.message ?? '失败')
        setClipping(false)
        return
      }
      const next = parseDelivery(response)
      setDelivery(next)
      setStatus(formatDelivery(next))
      setClipping(false)
      void refreshClient()
    })
  }

  return (
    <main className="flex w-80 flex-col gap-3 bg-background p-4 text-foreground">
      <header className="flex flex-col gap-1">
        <h1 className="text-base font-semibold tracking-tight">剪藏</h1>
        <p className="text-sm text-muted-foreground">把当前页写入知识库原文</p>
      </header>

      <p
        className="flex items-center gap-2 text-sm"
        role="status">
        <span
          className={clsx('size-2 rounded-full', health ? 'bg-primary' : 'bg-muted-foreground/50')}
          aria-hidden="true"
        />
        {health ? `客户端 ${health.port} 在线` : '客户端未连接'}
      </p>

      <Button
        type="button"
        className="h-11 w-full"
        disabled={isClipping}
        aria-busy={isClipping}
        onClick={onClip}>
        {isClipping ? '提取中…' : '剪藏当前页'}
      </Button>

      <p
        className="min-h-5 text-sm whitespace-pre-wrap text-muted-foreground"
        role="status"
        aria-live="polite">
        {status || (delivery ? formatDelivery(delivery) : '')}
      </p>

      {delivery?.title ? (
        <p
          className="truncate text-xs text-muted-foreground"
          title={delivery.url}>
          上次：{delivery.title}
        </p>
      ) : null}
    </main>
  )
}

export { PopupSurface }
