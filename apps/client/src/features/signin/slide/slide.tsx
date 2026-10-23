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

  // key 只用于每次 askSlide 时重挂载重置滑块；必须加前缀，
  // 否则初始值 0 会与表单里 <FormStagger key={motionKey}> 的 0 撞 key。
  const dialog = (
    <SlideDialog
      key={`slide-${ticket}`}
      open={isOpen}
      onFinish={finish}
    />
  )

  return { askSlide, dialog }
}

export { useSlideProof }
