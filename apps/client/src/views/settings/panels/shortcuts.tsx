import { Badge } from '@i-thinking/design/components/badge'
import { Button } from '@i-thinking/design/components/button'
import { Kbd, KbdGroup } from '@i-thinking/design/components/kbd'
import { useMemo, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import {
  bindingLabels,
  findBindingWarnings,
  findPlatform,
  parseBinding,
  validateBinding
} from '@/keyboard/binding'
import type { BindingConflict } from '@/keyboard/binding'
import {
  SHORTCUTS,
  findConflictsForChange,
  findShortcutConflicts,
  isCustomized,
  resolveBinding
} from '@/keyboard/definitions'
import { readGlobalShortcuts, subscribeGlobalShortcuts } from '@/keyboard/state'
import type { GlobalShortcutSnapshot } from '@/keyboard/state'
import type { GlobalShortcutRuntime, ShortcutDefinition, ShortcutScope } from '@/keyboard/types'
import { useSettingsStore } from '@/stores/setting'
import { SettingsSection } from '@/views/settings/panels/section.tsx'
import { ShortcutInput } from '@/views/settings/panels/shortcut-input'

const EMPTY_RUNTIME: GlobalShortcutSnapshot = {}

/** 分段标题就是「全局键与局部键的区别」的用户可见表达 */
const GROUP_LABEL: Record<ShortcutScope, string> = {
  global: '系统级 · 任何应用在前台都生效',
  app: '窗口级 · 仅在本应用的窗口生效',
  view: '视图级 · 打开对应工作区时生效',
  editor: '编辑器内 · 输入区聚焦时生效，不可修改'
}

const GROUP_ORDER: readonly ShortcutScope[] = ['global', 'app', 'view', 'editor']

/** 键位展示：能解析就逐个键帽，脏数据直接标红显示原文 */
function BindingKeys(props: { binding: string }) {
  const binding = parseBinding(props.binding)
  if (!binding) {
    return <span className="font-mono text-xs text-destructive">{props.binding}</span>
  }
  const labels = bindingLabels(binding, findPlatform())
  return (
    <KbdGroup>
      {labels.map(function (label) {
        return <Kbd key={label}>{label}</Kbd>
      })}
    </KbdGroup>
  )
}

function GlobalStatus(props: { runtime?: GlobalShortcutRuntime }) {
  const runtime = props.runtime
  if (!runtime || runtime.state === 'active') return null
  return (
    <Badge variant={runtime.state === 'unavailable' ? 'destructive' : 'secondary'}>
      {runtime.state === 'unavailable' ? '未生效' : '备用组合'}
    </Badge>
  )
}

interface ShortcutRowProps {
  definition: ShortcutDefinition
  binding: string
  isCustom: boolean
  conflict?: BindingConflict
  runtime?: GlobalShortcutRuntime
  onCommit: (id: string, binding: string) => Promise<boolean>
  onReset: (id: string) => void
}

function ShortcutRow(props: ShortcutRowProps) {
  const { definition, conflict, runtime } = props
  const hint = conflict?.message ?? runtime?.error

  return (
    <div className="flex items-start gap-4 border-b border-border/40 py-2 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-foreground">{definition.title}</span>
          <GlobalStatus runtime={runtime} />
          {conflict ? (
            <Badge variant={conflict.severity === 'block' ? 'destructive' : 'secondary'}>
              {conflict.severity === 'block' ? '冲突' : '覆盖'}
            </Badge>
          ) : null}
        </div>
        {hint ? (
          <p
            className={
              conflict?.severity === 'block' || runtime?.state === 'unavailable'
                ? 'text-xs leading-relaxed text-destructive'
                : 'text-xs leading-relaxed text-muted-foreground'
            }>
            {hint}
          </p>
        ) : null}
        {definition.scope !== 'global' && definition.extraBindings?.length ? (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>同时可用</span>
            {definition.extraBindings.map(function (extra) {
              return <BindingKeys key={extra} binding={extra} />
            })}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {definition.isConfigurable ? (
          <ShortcutInput
            value={props.binding}
            scope={definition.scope}
            ariaLabel={definition.title}
            onCommit={function (binding) {
              return props.onCommit(definition.id, binding)
            }}
          />
        ) : (
          <BindingKeys binding={props.binding} />
        )}
        {definition.isConfigurable && props.isCustom ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`把「${definition.title}」恢复为默认`}
            onClick={function () {
              props.onReset(definition.id)
            }}>
            恢复默认
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * 快捷键设置。
 *
 * 全部内容来自 `keyboard/definitions.ts` 的唯一键位表 —— 表里加一条这里就自动出现，
 * 冲突判定也复用表里的同一套规则（`findConflictsForChange`）。
 */
function ShortcutsPanel() {
  const shortcuts = useSettingsStore(function (state) {
    return state.settings.shortcuts
  })
  const toSetBinding = useSettingsStore(function (state) {
    return state.toSetBinding
  })
  const runtime = useSyncExternalStore(
    subscribeGlobalShortcuts,
    readGlobalShortcuts,
    function () {
      return EMPTY_RUNTIME
    }
  )

  const conflicts = useMemo(
    function () {
      return findShortcutConflicts(shortcuts.bindings)
    },
    [shortcuts.bindings]
  )

  const customized = SHORTCUTS.filter(function (definition) {
    return definition.isConfigurable && isCustomized(definition.id)
  })

  function findConflict(definition: ShortcutDefinition): BindingConflict | undefined {
    return conflicts.find(function (conflict) {
      return conflict.ids.some(function (id) {
        return id === definition.id || id.startsWith(`${definition.id}#`)
      })
    })
  }

  async function commit(id: string, binding: string): Promise<boolean> {
    const definition = SHORTCUTS.find(function (item) {
      return item.id === id
    })
    if (!definition) return false

    const error = validateBinding(binding, definition.scope)
    if (error) {
      toast.error(error)
      return false
    }

    const blocked = findConflictsForChange(id, binding)
    if (blocked.length > 0) {
      toast.error(blocked[0].message)
      return false
    }

    await toSetBinding(id, binding)

    const warnings = findBindingWarnings(binding, definition.scope)
    if (warnings.length > 0) toast.warning(warnings[0])
    return true
  }

  async function reset(id: string) {
    await toSetBinding(id, null)
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      {customized.length > 0 ? (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            已自定义 {customized.length} 项；恢复默认后跟随代码里的默认键位
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={function () {
              // 各键位互相独立：一个写失败不该拖垮其余，逐条报错
              void Promise.allSettled(
                customized.map(function (definition) {
                  return toSetBinding(definition.id, null)
                })
              ).then(function (results) {
                const failures = results.filter(function (result) {
                  return result.status === 'rejected'
                })
                if (failures.length > 0) {
                  console.warn('[settings] 恢复默认快捷键部分失败:', failures)
                  toast.error(`有 ${failures.length} 项没能恢复默认`)
                  return
                }
                toast.success('已恢复全部默认快捷键')
              })
            }}>
            恢复全部默认
          </Button>
        </div>
      ) : null}

      {GROUP_ORDER.map(function (scope) {
        const definitions = SHORTCUTS.filter(function (definition) {
          return definition.scope === scope
        })
        if (definitions.length === 0) return null
        return (
          <SettingsSection
            key={scope}
            title={GROUP_LABEL[scope]}>
            {definitions.map(function (definition) {
              return (
                <ShortcutRow
                  key={definition.id}
                  definition={definition}
                  binding={resolveBinding(definition.id)}
                  isCustom={isCustomized(definition.id)}
                  conflict={findConflict(definition)}
                  runtime={runtime[definition.id]}
                  onCommit={commit}
                  onReset={function (id) {
                    void reset(id)
                  }}
                />
              )
            })}
          </SettingsSection>
        )
      })}

      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        提示：系统级键会被操作系统拦下，可能被别的应用先占用；此时这里会显示实际生效的组合。
        展示为「不可修改」的是编辑器与浮层内的固定键位。
      </p>
    </div>
  )
}

export default ShortcutsPanel
