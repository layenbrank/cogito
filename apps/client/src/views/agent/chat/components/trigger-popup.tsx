/**
 * 通用触发浮层：按 behaviorId 拉文件搜索或技能列表
 */
import { Icon } from '@iconify/react/offline'
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  forwardRef,
  type Ref
} from 'react'

import styles from './trigger-popup.module.scss'
import { type SenderChip, type TriggerMatch } from './sender-trigger'
import { buildPopupItems, type PopupItem } from './trigger-popup-items'
import { useTriggerPopupData } from './use-trigger-popup-data'
import { normalizePath } from '@/features/agent/model/workspace-path'

interface TriggerPopupProps {
  match: TriggerMatch | null
  rootPaths: string[]
  /** 已插入 chip 的路径，浮层中不再可选 */
  excludedPaths?: string[]
  onPick: (chip: Omit<SenderChip, 'id'> & { id?: string }) => void
  onClose: () => void
}

interface TriggerPopupHandle {
  handleKeyDown: (event: { key: string }) => boolean
}

function TriggerPopupInner(props: TriggerPopupProps, ref: Ref<TriggerPopupHandle>) {
  const [activeIndex, updateActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const activeIndexRef = useRef(0)
  const selectableRef = useRef<PopupItem[]>([])
  const onPickRef = useRef(props.onPick)
  const onCloseRef = useRef(props.onClose)
  const openRef = useRef(false)

  useEffect(
    function () {
      onPickRef.current = props.onPick
      onCloseRef.current = props.onClose
    },
    [props.onPick, props.onClose]
  )

  useEffect(
    function () {
      activeIndexRef.current = activeIndex
    },
    [activeIndex]
  )

  const match = props.match
  const open = match !== null
  const behaviorId = match?.behaviorId ?? ''
  const query = match?.query ?? ''
  const kind = match?.kind ?? ''
  const hasRoots = props.rootPaths.length > 0

  const { fileHits, skills, isListLoading } = useTriggerPopupData({
    open,
    behaviorId,
    query,
    rootPaths: props.rootPaths
  })

  const excludedSet = useMemo(
    function () {
      return new Set((props.excludedPaths ?? []).map(normalizePath))
    },
    [props.excludedPaths]
  )

  const items: PopupItem[] = useMemo(
    function () {
      if (!match) return []
      return buildPopupItems({
        match,
        behaviorId,
        kind,
        query,
        hasRoots,
        fileHits,
        skills,
        isListLoading,
        excludedSet
      })
    },
    [match, behaviorId, kind, fileHits, skills, query, isListLoading, hasRoots, excludedSet]
  )

  const selectable = useMemo(
    function () {
      return items.filter(function (item) {
        return !item.key.startsWith('__')
      })
    },
    [items]
  )

  const activeResetKey = `${match?.char ?? ''}\0${match?.query ?? ''}\0${match?.behaviorId ?? ''}\0${items.length}`
  const [prevActiveResetKey, updatePrevActiveResetKey] = useState(activeResetKey)
  if (prevActiveResetKey !== activeResetKey) {
    updatePrevActiveResetKey(activeResetKey)
    updateActiveIndex(0)
  }

  useEffect(
    function () {
      selectableRef.current = selectable
    },
    [selectable]
  )

  useEffect(
    function () {
      const root = listRef.current
      if (!root) return
      const active = root.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      active?.scrollIntoView({ block: 'nearest' })
    },
    [activeIndex]
  )

  useEffect(
    function () {
      openRef.current = open
    },
    [open]
  )

  function pickAt(index: number) {
    const item = selectableRef.current[index]
    if (!item || !item.chip.label) return
    onPickRef.current(item.chip)
  }

  useImperativeHandle(ref, function () {
    return {
      handleKeyDown: function (event) {
        if (!openRef.current) return false
        if (event.key === 'Escape') {
          onCloseRef.current()
          return true
        }
        const rows = selectableRef.current
        if (rows.length === 0) {
          if (event.key === 'Enter') return true
          return false
        }
        if (event.key === 'ArrowDown') {
          updateActiveIndex(function (index) {
            return (index + 1) % rows.length
          })
          return true
        }
        if (event.key === 'ArrowUp') {
          updateActiveIndex(function (index) {
            return (index - 1 + rows.length) % rows.length
          })
          return true
        }
        if (event.key === 'Enter') {
          pickAt(activeIndexRef.current)
          return true
        }
        return false
      }
    }
  })

  if (!open) return null

  return (
    <div
      className={styles.root}
      role="listbox"
      aria-label="触发建议">
      <div
        ref={listRef}
        className={styles.list}>
        {items.map(function (item) {
          const disabled = item.key.startsWith('__')
          const selectIndex = selectable.findIndex(function (row) {
            return row.key === item.key
          })
          const isActive = !disabled && selectIndex === activeIndex
          return (
            <button
              key={item.key}
              type="button"
              role="option"
              aria-selected={isActive}
              data-index={disabled ? undefined : selectIndex}
              className={styles.item}
              data-active={isActive ? 'true' : undefined}
              data-disabled={disabled ? 'true' : undefined}
              disabled={disabled}
              onMouseDown={function (event) {
                event.preventDefault()
              }}
              onClick={function () {
                if (disabled) return
                pickAt(selectIndex)
              }}>
              <Icon
                icon={item.icon}
                width={16}
                height={16}
                className={styles.icon}
              />
              <span className={styles.label}>{item.label}</span>
              {item.extra ? (
                <span
                  className={styles.extra}
                  title={item.extra}>
                  {item.extra}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const TriggerPopup = forwardRef(TriggerPopupInner)
TriggerPopup.displayName = 'TriggerPopup'

export { TriggerPopup }
export type { TriggerPopupHandle, TriggerPopupProps }
