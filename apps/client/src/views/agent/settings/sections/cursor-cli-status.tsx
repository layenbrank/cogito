/**
 * 设置 · 模型：本机 Cursor Agent CLI 登录状态（agent status）。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Spinner } from '@cogito/design/components/spinner'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import {
  fetchCursorAgentStatus,
  type CursorAgentStatus
} from '@/features/agent/cursor-agent'
import styles from '@/views/agent/settings/settings.module.scss'

function findStatusLabel(status: CursorAgentStatus | null, busy: boolean): string {
  if (busy) return '检测中…'
  if (!status) return '尚未检测'
  if (!status.found) return '未安装'
  if (status.authenticated) return '已登录'
  return '未登录'
}

function CursorCliStatusSection() {
  const [status, updateStatus] = useState<CursorAgentStatus | null>(null)
  const [busy, updateBusy] = useState(false)

  async function refresh() {
    updateBusy(true)
    try {
      const next = await fetchCursorAgentStatus()
      updateStatus(next)
    } catch (error) {
      console.warn('[settings/cursor-cli] 探测失败:', error)
      toast.error(error instanceof Error ? error.message : '探测 Cursor Agent 失败')
    } finally {
      updateBusy(false)
    }
  }

  useEffect(function () {
    void refresh()
  }, [])

  const label = findStatusLabel(status, busy)
  const isOk = Boolean(status?.authenticated)

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>Cursor Agent CLI</span>
        <span className={styles.sectionMeta}>{label}</span>
      </div>

      <div className={styles.list}>
        <div className={styles.row}>
          <div className={styles.rowIdentity}>
            <span className={styles.cardBadge}>
              <Icon
                icon="lucide:terminal"
                width={16}
                height={16}
              />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={styles.cardName}>本机 Cursor CLI</span>
                {busy ? (
                  <Spinner className="size-3.5" />
                ) : isOk ? (
                  <span className={styles.statusLabelOk}>可用</span>
                ) : (
                  <span className={styles.statusLabelFail}>需登录</span>
                )}
              </div>
              <p className={styles.rowMeta}>
                {status?.binaryPath
                  ? status.binaryPath
                  : '选用 Cursor Agent 模型前，请先在本机完成 CLI 登录'}
              </p>
              {status?.detail ? (
                <p
                  className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground"
                  title={status.detail}>
                  {status.detail}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                终端执行 <code className="rounded bg-muted px-1">agent login</code>
                ，或设置环境变量 <code className="rounded bg-muted px-1">CURSOR_API_KEY</code>
                后完整重启客户端。与 Cogito 账号登录无关。
              </p>
            </div>
          </div>
          <div className={styles.rowActions}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={styles.keyBtn}
              disabled={busy}
              onClick={function () {
                void refresh()
              }}>
              <Icon
                icon="lucide:refresh-cw"
                className="size-3.5"
              />
              重新检测
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

export { CursorCliStatusSection }
