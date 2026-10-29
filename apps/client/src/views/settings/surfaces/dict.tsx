/**
 * 设置 · 状态文案：改字典 label（禁止改 value）。
 */
import { Input } from '@cogito/design/components/input'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { DICT_TYPE } from '@/shared/ipc/specs/dict'
import { useDictStore } from '@/stores/dict'
import {
  SURFACE_STACK,
  SettingsRow,
  SettingsSection
} from '@/views/settings/surfaces/section.tsx'

const EDITABLE_TYPES = [
  { code: DICT_TYPE.KNOWLEDGE_DOC_STATUS, title: '文档状态' },
  { code: DICT_TYPE.KNOWLEDGE_DOC_SOURCE, title: '文档来源' },
  { code: DICT_TYPE.KNOWLEDGE_CLOUD_STATUS, title: '云端索引' },
  { code: DICT_TYPE.KNOWLEDGE_BASE_SCOPE, title: '知识库范围' },
  { code: DICT_TYPE.AUTOMATION_RUN_STATUS, title: '任务运行状态' },
  { code: DICT_TYPE.AUTOMATION_TRIGGER_KIND, title: '任务触发方式' },
  { code: DICT_TYPE.AUTOMATION_OWNER, title: '任务执行方' },
  { code: DICT_TYPE.AUTOMATION_RUN_AS, title: '任务运行身份' },
  { code: DICT_TYPE.DIRECTIVE_DRAFT_STATUS, title: '指令草稿状态' },
  { code: DICT_TYPE.ASSET_STATUS, title: '资源状态' },
  { code: DICT_TYPE.ALBUM_STATUS, title: '相簿状态' }
] as const

function DictSurface() {
  const byType = useDictStore(function (state) {
    return state.byType
  })
  const isReady = useDictStore(function (state) {
    return state.isReady
  })
  const bootstrap = useDictStore(function (state) {
    return state.bootstrap
  })
  const updateLabel = useDictStore(function (state) {
    return state.updateLabel
  })
  const storeLabels = useMemo(
    function () {
      if (!isReady) return null
      const next: Record<string, string> = {}
      for (const group of EDITABLE_TYPES) {
        for (const item of byType[group.code] ?? []) {
          next[item.id] = item.label
        }
      }
      return next
    },
    [byType, isReady]
  )
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [labelsSnap, setLabelsSnap] = useState<Record<string, string> | null>(null)
  if (storeLabels && storeLabels !== labelsSnap) {
    setLabelsSnap(storeLabels)
    setDrafts(storeLabels)
  }

  useEffect(
    function () {
      void bootstrap()
    },
    [bootstrap]
  )

  async function commitLabel(id: string) {
    const label = (drafts[id] ?? '').trim()
    if (!label) {
      toast.error('文案不能为空')
      return
    }
    const ok = await updateLabel(id, label)
    if (ok) toast.success('已更新文案')
    else toast.error('更新失败')
  }

  return (
    <div className={SURFACE_STACK}>
      <p className="text-xs text-muted-foreground">
        仅可改显示文案；编码（value）固定，业务逻辑只认编码。
      </p>
      {EDITABLE_TYPES.map(function (group) {
        const items = byType[group.code] ?? []
        if (items.length === 0) return null
        return (
          <SettingsSection
            key={group.code}
            title={group.title}>
            {items.map(function (item) {
              return (
                <SettingsRow
                  key={item.id}
                  label={item.value}
                  hint={`编码 ${item.value}${item.isDefault ? ' · 默认' : ''}`}>
                  <Input
                    value={drafts[item.id] ?? item.label}
                    className="h-7 max-w-56 text-xs"
                    onChange={function (event) {
                      const value = event.target.value
                      setDrafts(function (prev) {
                        return { ...prev, [item.id]: value }
                      })
                    }}
                    onBlur={function () {
                      const next = (drafts[item.id] ?? '').trim()
                      if (next && next !== item.label) void commitLabel(item.id)
                    }}
                    onKeyDown={function (event) {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur()
                      }
                    }}
                  />
                </SettingsRow>
              )
            })}
          </SettingsSection>
        )
      })}
    </div>
  )
}

export default DictSurface
