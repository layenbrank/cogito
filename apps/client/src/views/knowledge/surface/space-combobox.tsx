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

import type { KnowledgeSpace } from '@/shared/ipc/specs/knowledge'
import { findKnowledgeSpaceLabel } from '@/views/knowledge/lib/space-label.ts'

interface SpaceOption {
  value: string
  label: string
}

interface SpaceComboboxProps {
  spaces: Array<Pick<KnowledgeSpace, 'id' | 'name' | 'slug'>>
  value: string | null
  onValueChange: (spaceID: string) => void
  className?: string
  placeholder?: string
  'aria-label'?: string
}

function SpaceCombobox(props: SpaceComboboxProps) {
  const placeholder = props.placeholder ?? '选择空间'
  const ariaLabel = props['aria-label'] ?? placeholder

  const options = useMemo(
    function () {
      return props.spaces.map(function (space): SpaceOption {
        return {
          value: space.id,
          label: findKnowledgeSpaceLabel(space)
        }
      })
    },
    [props.spaces]
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
        <ComboboxEmpty>无匹配空间</ComboboxEmpty>
        <ComboboxList>
          {function (item: SpaceOption) {
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

export { SpaceCombobox }
export type { SpaceComboboxProps }
