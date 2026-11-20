import type { ReactNode } from 'react'

import { TileDragContext, type TileDrag } from './drag-state.ts'

export function TileDragProvider(props: { value: TileDrag; children: ReactNode }) {
  return <TileDragContext.Provider value={props.value}>{props.children}</TileDragContext.Provider>
}
