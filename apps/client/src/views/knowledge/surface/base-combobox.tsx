/**
 * 知识库选择：@cogito/design Combobox（可搜索；弹层与触发器同宽贴合）。
 */
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList
} from '@cogito/design/components/combobox'
import { useMemo } from 'react'

import type { KnowledgeBase } from '@/shared/ipc/specs/knowledge'
import { findKnowledgeBaseLabel } from '@/views/knowledge/lib/base-label.ts'

interface BaseOption {
  value: string
  label: string
}

interface BaseComboboxProps {
  bases: Array<Pick<KnowledgeBase, 'id' | 'name' | 'slug'>>
  value: string | null
  onValueChange: (baseID: string) => void
  className?: string
  placeholder?: string
  'aria-label'?: string
}

function BaseCombobox(props: BaseComboboxProps) {
  const placeholder = props.placeholder ?? '选择知识库'
  const ariaLabel = props['aria-label'] ?? placeholder

  const options = useMemo(
    function () {
      return props.bases.map(function (base): BaseOption {
        return {
          value: base.id,
          label: findKnowledgeBaseLabel(base)
        }
      })
    },
    [props.bases]
  )

  const selected = useMemo(
    function () {
      if (!props.value) return null
      return (
        options.find(function (option) {
          return option.value === props.value
        }) ?? null
      )
    },
    [options, props.value]
  )

  return (
    <Combobox
      items={options}
      value={selected}
      autoHighlight
      isItemEqualToValue={function (item, next) {
        return item.value === next.value
      }}
      onValueChange={function (next) {
        if (next?.value) props.onValueChange(next.value)
      }}>
      <div className={props.className ?? 'min-w-0 flex-1 basis-0'}>
        <ComboboxInput
          size="sm"
          placeholder={placeholder}
          aria-label={ariaLabel}
        />
      </div>
      <ComboboxContent
        size="sm"
        align="start">
        <ComboboxEmpty>无匹配知识库</ComboboxEmpty>
        <ComboboxList>
          {function (item: BaseOption) {
            return (
              <ComboboxItem
                key={item.value}
                value={item}>
                {item.label}
              </ComboboxItem>
            )
          }}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

export { BaseCombobox }
export type { BaseComboboxProps }
