import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { CLIP_PORTS, formatDelivery, probeClient } from '@cogito/clipper/protocol'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { ClientHealth, ClipDelivery } from '@cogito/clipper/protocol'

import { findClipperId, requestClip, requestHealth, writeClipperId } from '@/features/clip-bridge/bridge.ts'
import { parseStoredDelivery, STORAGE_CLIP_DELIVERY } from '@/features/clip-bridge/inbox.ts'

function ClipAction() {
  const [clipperId, setClipperId] = useState('')
  const [health, setHealth] = useState<ClientHealth | null>(null)
  const [delivery, setDelivery] = useState<ClipDelivery | null>(null)
  const [isClipping, setClipping] = useState(false)
  const runtimeId = chrome.runtime.id

  async function refreshClient(id: string): Promise<void> {
    const direct = await probeClient(CLIP_PORTS)
    if (direct) {
      setHealth(direct)
      return
    }
    if (!id) {
      setHealth(null)
      return
    }
    const viaClipper = await requestHealth(id)
    setHealth(viaClipper)
  }

  useEffect(function () {
    void findClipperId()
      .then(function (id) {
        setClipperId(id)
        return refreshClient(id)
      })
      .catch(function (error: unknown) {
        console.error('[clip] 初始化失败', error)
      })

    void chrome.storage.local
      .get(STORAGE_CLIP_DELIVERY)
      .then(function (bag) {
        setDelivery(parseStoredDelivery(bag[STORAGE_CLIP_DELIVERY]))
      })
      .catch(function (error: unknown) {
        console.error('[clip] 读取上次剪藏失败', error)
      })

    function onChanged(changes: { [key: string]: chrome.storage.StorageChange }, area: string): void {
      if (area !== 'local' || !changes[STORAGE_CLIP_DELIVERY]) return
      setDelivery(parseStoredDelivery(changes[STORAGE_CLIP_DELIVERY].newValue))
    }

    chrome.storage.onChanged.addListener(onChanged)
    return function () {
      chrome.storage.onChanged.removeListener(onChanged)
    }
  }, [])

  function onClipperId(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value
    setClipperId(value)
    void writeClipperId(value).catch(function (error: unknown) {
      console.error('[clip] 保存剪藏扩展 ID 失败', error)
    })
  }

  function onClip(): void {
    const id = clipperId.trim()
    if (!id) {
      setDelivery({ ok: false, error: '先填写剪藏扩展 ID' })
      return
    }
    setClipping(true)
    void requestClip(id)
      .then(function (next) {
        setDelivery(next)
        return refreshClient(id)
      })
      .catch(function (error: unknown) {
        console.error('[clip] 请求剪藏失败', error)
        setDelivery({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
      .finally(function () {
        setClipping(false)
      })
  }

  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground">知识库剪藏</h2>
      <p className="flex items-center gap-2 text-sm" role="status">
        <span
          className={clsx('size-2 rounded-full', health ? 'bg-primary' : 'bg-muted-foreground/50')}
          aria-hidden="true"
        />
        {health ? `客户端 ${health.port} 在线` : '客户端未连接'}
      </p>
      <Button type="button" className="h-11 w-full" disabled={isClipping} aria-busy={isClipping} onClick={onClip}>
        {isClipping ? '剪藏中…' : '剪藏到知识库'}
      </Button>
      <p className="min-h-5 text-sm whitespace-pre-wrap text-muted-foreground" role="status" aria-live="polite">
        {delivery ? formatDelivery(delivery) : ''}
      </p>
      <p className="truncate font-mono text-xs" title={runtimeId}>
        本扩展 {runtimeId}
      </p>
      <label className="flex flex-col gap-1 text-sm" htmlFor="clipper-id">
        剪藏扩展 ID
        <Input id="clipper-id" value={clipperId} autoComplete="off" spellCheck={false} onChange={onClipperId} />
      </label>
    </section>
  )
}

export { ClipAction }
