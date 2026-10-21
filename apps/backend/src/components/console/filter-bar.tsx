import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput
} from '@i-thinking/design/components/input-group'
import { Icon } from '@iconify/react/offline'
import type { ReactNode } from 'react'

interface FilterBarProps {
  search?: string
  searchPlaceholder?: string
  onSearchChange?(value: string): void
  children?: ReactNode
}

function FilterBar(props: FilterBarProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
      {props.onSearchChange ? (
        <InputGroup className="h-10 max-w-md min-w-[16rem] flex-1 shadow-none">
          <InputGroupAddon align="inline-start">
            <Icon
              icon="lucide:search"
              className="size-4 text-muted-foreground"
            />
          </InputGroupAddon>
          <InputGroupInput
            className="text-sm"
            placeholder={props.searchPlaceholder ?? '搜索…'}
            value={props.search ?? ''}
            onChange={function (event) {
              props.onSearchChange?.(event.target.value)
            }}
          />
        </InputGroup>
      ) : null}
      {props.children}
    </div>
  )
}

export { FilterBar }
