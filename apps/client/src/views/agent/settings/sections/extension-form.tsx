/**
 * 添加 MCP 扩展的内联表单：名称 + 传输形态（streamable HTTP / stdio）+ 形态专有字段。
 *
 * 「表单文本 → 线格式」的转换在 `features/agent/model/extension.ts`（纯函数，有单测）；
 * 这里只管取值、报错与提交。
 */
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Spinner } from '@cogito/design/components/spinner'
import { Textarea } from '@cogito/design/components/textarea'
import { useState } from 'react'
import { toast } from 'sonner'

import { findAcpHandle } from '@/features/agent/acp/connection'
import { addConfigExtension } from '@/features/agent/acp/goose-extensions'
import { waitGooseReady } from '@/features/agent/acp/session'
import {
  buildExtension,
  makeExtensionDraft,
  findExtensionName,
  type ExtensionDraft,
  type ExtensionServer
} from '@/features/agent/model/extension'
import styles from '@/views/agent/settings/settings.module.scss'

interface ExtensionFormProps {
  onSaved: () => void
  onCancel: () => void
}

const TRANSPORTS: Array<{ value: ExtensionServer['type']; label: string }> = [
  { value: 'http', label: 'HTTP（streamable）' },
  { value: 'stdio', label: '本地进程（stdio）' }
]

function ExtensionForm(props: ExtensionFormProps) {
  const [draft, updateDraft] = useState<ExtensionDraft>(makeExtensionDraft)
  const [saving, updateSaving] = useState(false)

  function patch(next: Partial<ExtensionDraft>) {
    updateDraft(function (prev) {
      return { ...prev, ...next }
    })
  }

  async function submit() {
    updateSaving(true)
    try {
      const extension = buildExtension(draft)
      await waitGooseReady()
      const handle = await findAcpHandle()
      await addConfigExtension(handle.connection, extension)
      toast.success(`${findExtensionName(extension)} 已加入扩展配置`)
      props.onSaved()
    } catch (error) {
      console.warn('[settings/extensions] 添加扩展失败:', error)
      const detail = error instanceof Error ? error.message : '添加失败'
      toast.error(detail)
    } finally {
      updateSaving(false)
    }
  }

  return (
    <div className={styles.addForm}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>名称 *</span>
        <Input
          value={draft.name}
          placeholder="扩展在 goose 里的名字"
          onChange={function (event) {
            patch({ name: event.target.value })
          }}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>传输形态</span>
        <Select
          value={draft.kind}
          onValueChange={function (value) {
            patch({ kind: value as ExtensionServer['type'] })
          }}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRANSPORTS.map(function (transport) {
              return (
                <SelectItem
                  key={transport.value}
                  value={transport.value}>
                  {transport.label}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </label>

      {draft.kind === 'http' ? (
        <>
          <label className={`${styles.field} col-span-full`}>
            <span className={styles.fieldLabel}>服务地址 *</span>
            <Input
              value={draft.url}
              placeholder="https://example.com/mcp"
              onChange={function (event) {
                patch({ url: event.target.value })
              }}
            />
          </label>
          <label className={`${styles.field} col-span-full`}>
            <span className={styles.fieldLabel}>请求头（每行一条 `名称: 值`）</span>
            <Textarea
              rows={3}
              value={draft.headers}
              placeholder={'Authorization: Bearer …\nX-Tenant-ID: …'}
              onChange={function (event) {
                patch({ headers: event.target.value })
              }}
            />
          </label>
        </>
      ) : (
        <>
          <label className={`${styles.field} col-span-full`}>
            <span className={styles.fieldLabel}>启动命令 *</span>
            <Input
              value={draft.command}
              placeholder="可执行文件路径"
              onChange={function (event) {
                patch({ command: event.target.value })
              }}
            />
          </label>
          <label className={`${styles.field} col-span-full`}>
            <span className={styles.fieldLabel}>参数（每行一个）</span>
            <Textarea
              rows={2}
              value={draft.args}
              onChange={function (event) {
                patch({ args: event.target.value })
              }}
            />
          </label>
          <label className={`${styles.field} col-span-full`}>
            <span className={styles.fieldLabel}>环境变量（每行一条 `KEY=VALUE`，按密钥存进 goose）</span>
            <Textarea
              rows={2}
              value={draft.env}
              onChange={function (event) {
                patch({ env: event.target.value })
              }}
            />
          </label>
        </>
      )}

      <label className={`${styles.field} col-span-full`}>
        <span className={styles.fieldLabel}>描述</span>
        <Input
          value={draft.description}
          onChange={function (event) {
            patch({ description: event.target.value })
          }}
        />
      </label>

      <div className="col-span-full flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={props.onCancel}>
          取消
        </Button>
        <Button
          disabled={saving}
          onClick={function () {
            void submit()
          }}>
          {saving ? <Spinner /> : null}
          添加
        </Button>
      </div>
    </div>
  )
}

export { ExtensionForm }
