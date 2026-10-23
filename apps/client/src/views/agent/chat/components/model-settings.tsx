/**
 * Qoder 风格模型设置：思考强度 / 显示状态 / 上下文窗口
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Switch } from '@cogito/design/components/switch'
import { clsx } from 'clsx'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { toast } from 'sonner'

import {
  canThink,
  CONTEXT_INDEX_MARKS,
  CONTEXT_STEPS,
  findContextByIndex,
  findContextIndex,
  findModelKey,
  findModelPref,
  MODEL_PREF,
  readModelPrefs,
  THINKING_OPTIONS,
  writeModelPrefs,
  type ModelPref
} from '@/features/agent/model/model-prefs'
import { syncCogitoGatewayCatalog } from '@/features/agent/acp/cogito-provider'
import { findModelLabel } from '@/features/agent/model/display'
import { parseModels } from '@/features/agent/model/providers'
import styles from './model-settings.module.scss'
import { useProviderStore } from '@/stores/provider'

interface ModelSettingsProps {
  open: boolean
  onClose: () => void
  /** 跳转接入管理（无模型时） */
  onOpenProviders?: () => void
}

interface ModelRow {
  key: string
  providerID: string
  providerName: string
  providerKind: string
  model: string
  supportsThinking: boolean
}

interface ContextWindowControlProps {
  value: number
  onChange: (contextWindow: number) => void
}

const CONTEXT_LAST = CONTEXT_STEPS.length - 1

function clampRatio(value: number) {
  return Math.min(1, Math.max(0, value))
}

function findRatioByIndex(index: number) {
  if (CONTEXT_LAST <= 0) return 0
  return clampRatio(index / CONTEXT_LAST)
}

function findIndexByRatio(ratio: number) {
  return Math.round(clampRatio(ratio) * CONTEXT_LAST)
}
function ContextWindowControl(props: ContextWindowControlProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [dragging, updateDragging] = useState(false)
  const [ratio, updateRatio] = useState(function () {
    return findRatioByIndex(findContextIndex(props.value))
  })

  const active = findIndexByRatio(ratio)
  const label = CONTEXT_INDEX_MARKS[active]

  useEffect(
    function () {
      if (draggingRef.current) return
      updateRatio(findRatioByIndex(findContextIndex(props.value)))
    },
    [props.value]
  )

  function findRatioFromClientX(clientX: number) {
    const track = trackRef.current
    if (!track) return ratio
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return ratio
    return clampRatio((clientX - rect.left) / rect.width)
  }

  function commitRatio(nextRatio: number) {
    const parsed = clampRatio(nextRatio)
    updateRatio(parsed)
    props.onChange(findContextByIndex(findIndexByRatio(parsed)))
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    draggingRef.current = true
    updateDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    commitRatio(findRatioFromClientX(event.clientX))
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return
    commitRatio(findRatioFromClientX(event.clientX))
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return
    draggingRef.current = false
    updateDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const snapped = findRatioByIndex(findIndexByRatio(findRatioFromClientX(event.clientX)))
    commitRatio(snapped)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      commitRatio(findRatioByIndex(Math.max(0, active - 1)))
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      commitRatio(findRatioByIndex(Math.min(CONTEXT_LAST, active + 1)))
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      commitRatio(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      commitRatio(1)
    }
  }

  return (
    <div className={clsx(styles.contextControl, dragging && styles.contextDragging)}>
      <div className={styles.contextValue}>{label}</div>
      <div
        ref={trackRef}
        className={styles.contextTrack}
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={CONTEXT_LAST}
        aria-valuenow={active}
        aria-valuetext={label}
        aria-label="上下文窗口"
        onKeyDown={handleKeyDown}
        data-at-start={ratio <= 0 ? 'true' : undefined}
        data-at-end={ratio >= 1 ? 'true' : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}>
        <span
          className={styles.contextFill}
          style={{ width: `${ratio * 100}%` }}
        />
        <span
          className={styles.contextThumb}
          style={{ left: `${ratio * 100}%` }}
        />
      </div>

      <div className={styles.contextLabels}>
        {CONTEXT_STEPS.map(function (_step, index) {
          return (
            <Button
              key={CONTEXT_INDEX_MARKS[index]}
              type="button"
              variant="ghost"
              size="sm"
              className={clsx(styles.contextLabel, index === active && styles.contextLabelActive)}
              onClick={function () {
                commitRatio(findRatioByIndex(index))
              }}>
              {CONTEXT_INDEX_MARKS[index]}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

function AgentModelSettings(props: ModelSettingsProps) {
  const providers = useProviderStore(function (state) {
    return state.providers
  })

  const [draft, updateDraft] = useState<Record<string, ModelPref>>({})
  const [saving, updateSaving] = useState(false)

  const rows = useMemo(
    function () {
      const result: ModelRow[] = []
      for (const provider of providers) {
        for (const model of parseModels(provider.models)) {
          result.push({
            key: findModelKey(provider.id, model),
            providerID: provider.id,
            providerName: provider.name,
            providerKind: provider.name || provider.kind,
            model,
            supportsThinking: canThink(model)
          })
        }
      }
      return result
    },
    [providers]
  )

  useEffect(
    function () {
      if (!props.open) return
      let cancelled = false
      void useProviderStore
        .getState()
        .toReadProviders()
        .then(function () {
          return syncCogitoGatewayCatalog()
        })
        .then(function () {
          if (cancelled) return
          const prefs = readModelPrefs()
          const next: Record<string, ModelPref> = {}
          for (const provider of useProviderStore.getState().providers) {
            for (const model of parseModels(provider.models)) {
              const key = findModelKey(provider.id, model)
              next[key] = findModelPref(provider.id, model, prefs)
            }
          }
          updateDraft(next)
        })
        .catch(function (error) {
          console.warn('[model-settings] 同步组织模型失败:', error)
        })
      return function () {
        cancelled = true
      }
    },
    [props.open]
  )

  function patchPref(key: string, change: Partial<ModelPref>) {
    updateDraft(function (prev) {
      return {
        ...prev,
        [key]: {
          ...(prev[key] ?? { ...MODEL_PREF }),
          ...change
        }
      }
    })
  }

  function handleSave() {
    updateSaving(true)
    try {
      writeModelPrefs(draft)
      toast.success('已保存模型设置')
      props.onClose()
    } finally {
      updateSaving(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={function (open) {
        if (!open) props.onClose()
      }}>
      <DialogContent className={styles.modal}>
        <DialogHeader>
          <DialogTitle className={styles.title}>模型设置</DialogTitle>
          <DialogDescription className={styles.desc}>
            这些偏好对所有任务生效。运行中的回复保持当前设置，下一轮开始使用新设置。
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className={styles.empty}>
            <span className="text-muted-foreground">暂无可用模型</span>
            {props.onOpenProviders ? (
              <div className={styles.emptyAction}>
                <Button
                  variant="link"
                  onClick={function () {
                    props.onClose()
                    props.onOpenProviders?.()
                  }}>
                  去添加模型接入
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className="text-start">模型名称</th>
                <th className="text-start">思考强度</th>
                <th className="text-center">显示状态</th>
                <th className="text-start">上下文窗口</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(function (row) {
                const pref = draft[row.key] ?? MODEL_PREF
                return (
                  <tr key={row.key}>
                    <td>
                      <div className={styles.modelCell}>
                        <span className={styles.modelBadge}>
                          <Icon
                            icon="lucide:box"
                            width={18}
                            height={18}
                          />
                        </span>
                        <div className="flex min-w-0 flex-col">
                          <span className={styles.modelName}>{findModelLabel(row.model)}</span>
                          <span className={styles.modelMeta}>{row.providerName}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      {row.supportsThinking ? (
                        <Select
                          items={THINKING_OPTIONS}
                          value={pref.thinking}
                          onValueChange={function (value) {
                            if (value === null) return
                            patchPref(row.key, { thinking: value })
                          }}>
                          <SelectTrigger
                            size="sm"
                            aria-label="思考强度"
                            className={styles.thinkingSelect}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {THINKING_OPTIONS.map(function (option) {
                              return (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}>
                                  {option.label}
                                </SelectItem>
                              )
                            })}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className={styles.unsupported}>不支持</span>
                      )}
                    </td>
                    <td>
                      <div className="flex justify-center">
                        <Switch
                          size="sm"
                          checked={pref.visible}
                          onCheckedChange={function (checked) {
                            patchPref(row.key, { visible: checked })
                          }}
                        />
                      </div>
                    </td>
                    <td>
                      <ContextWindowControl
                        value={pref.contextWindow}
                        onChange={function (contextWindow) {
                          patchPref(row.key, { contextWindow })
                        }}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            className={styles.cancelBtn}
            onClick={props.onClose}>
            取消
          </Button>
          <Button
            className={styles.saveBtn}
            disabled={saving}
            onClick={function () {
              handleSave()
            }}>
            保存设置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { AgentModelSettings }
export type { ModelSettingsProps }
