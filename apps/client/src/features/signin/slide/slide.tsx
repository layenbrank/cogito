import { useRef, useState } from 'react'

import type { SlideProof } from '@/apis/auth'
import { SlideDialog } from './dialog'

function useSlideProof() {
  const [isOpen, updateOpen] = useState(false)
  const [ticket, updateTicket] = useState(0)
  const resolver = useRef<((proof: SlideProof | null) => void) | null>(null)

  function askSlide(): Promise<SlideProof | null> {
    updateTicket(function (current) {
      return current + 1
    })
    updateOpen(true)
    return new Promise(function (resolve) {
      resolver.current = resolve
    })
  }

  function finish(proof: SlideProof | null) {
    updateOpen(false)
    const resolve = resolver.current
    resolver.current = null
    resolve?.(proof)
  }

  const dialog = (
    <SlideDialog
      key={ticket}
      open={isOpen}
      onFinish={finish}
    />
  )

  return { askSlide, dialog }
}

export { useSlideProof }
