import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'

import { findExtensionId, findPortOrder, writeExtensionId } from '@/features/relay/session.ts'
import { MESSAGE_CLIP_ACTIVE } from '@/protocol/constants.ts'
import { probeClient } from '@/protocol/client.ts'
import { formatDelivery, parseDelivery } from '@/protocol/payload.ts'

import type { ClientHealth } from '@/protocol/payload.ts'

function PopupSurface() {
  const [health, setHealth] = useState<ClientHealth | null>(null)
  const [status, setStatus] = useState('')
  const [isClipping, setClipping] = useState(false)
  const [extensionId, setExtensionId] = useState('')
  const runtimeId = chrome.runtime.id

  async function refreshClient(): Promise<void> {
    const ports = await findPortOrder()
    const next = await probeClient(ports)
    setHealth(next)
  }

  useEffect(function () {
    void refreshClient()
    void findExtensionId()
      .then(function (id) {
        setExtensionId(id)
      })
      .catch(function (error: unknown) {
        console.error('[clipper] 读取对端失败', error)
      })
  }, [])

  function onClip(): void {
    setClipping(true)
    setStatus('提取中…')
    chrome.runtime.sendMessage({ type: MESSAGE_CLIP_ACTIVE }, function (response: unknown) {
      const lastError = chrome.runtime.lastError
      if (lastError) {
        console.error('[clipper] 剪藏失败', lastError)
        setStatus(lastError.message ?? '失败')
        setClipping(false)
        return
      }
      setStatus(formatDelivery(parseDelivery(response)))
      setClipping(false)
      void refreshClient()
    })
  }

  function onCopyId(): void {
    void navigator.clipboard.writeText(runtimeId).catch(function (error: unknown) {
      console.error('[clipper] 复制扩展 ID 失败', error)
      setStatus('复制失败')
    })
  }

  function onExtensionId(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value
    setExtensionId(value)
    void writeExtensionId(value).catch(function (error: unknown) {
      console.error('[clipper] 保存对端失败', error)
    })
  }

  return (
    <main className="flex w-80 flex-col gap-3 bg-background p-4 text-foreground">
      <header className="flex flex-col gap-1">
        <h1 className="text-base font-semibold tracking-tight">剪藏</h1>
        <p className="text-sm text-muted-foreground">把当前页写入知识库原文</p>
      </header>

      <p className="flex items-center gap-2 text-sm" role="status">
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

      <p className="min-h-5 text-sm whitespace-pre-wrap text-muted-foreground" role="status" aria-live="polite">
        {status}
      </p>

      <section className="flex flex-col gap-2 border-t border-border pt-3">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground">连接新标签扩展</h2>
        <p className="truncate font-mono text-xs text-foreground" title={runtimeId}>
          {runtimeId}
        </p>
        <Button type="button" variant="secondary" className="h-11 w-full" onClick={onCopyId}>
          复制本扩展 ID
        </Button>
        <label className="flex flex-col gap-1 text-sm" htmlFor="extension-id">
          新标签扩展 ID
          <Input
            id="extension-id"
            value={extensionId}
            autoComplete="off"
            spellCheck={false}
            onChange={onExtensionId}
          />
        </label>
      </section>
    </main>
  )
}

export { PopupSurface }
