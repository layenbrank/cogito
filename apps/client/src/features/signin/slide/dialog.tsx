import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@i-thinking/design/components/dialog'
import GoCaptcha from 'go-captcha-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { POST_CAPTCHA, type CaptchaChallenge, type SlideProof } from '@/apis/auth.ts'
import { HttpError } from '@/utils/http/errors.ts'

interface SlidePoint {
  x: number
  y: number
}

interface SlideDialogProps {
  open: boolean
  onFinish: (proof: SlideProof | null) => void
}

/** check-data 的 value 必须是 "x,y"。只传 x 时 y 被当成 0，拼图对了也失败。 */
function formatSlideValue(point: SlidePoint) {
  return `${point.x},${point.y}`
}

function SlideDialog(props: SlideDialogProps) {
  const { open } = props
  const onFinish = useRef(props.onFinish)
  const isSettled = useRef(false)
  const [challenge, updateChallenge] = useState<CaptchaChallenge | null>(null)
  const [epoch, updateEpoch] = useState(0)

  useEffect(
    function () {
      onFinish.current = props.onFinish
    },
    [props.onFinish]
  )

  useEffect(
    function () {
      if (!open) return

      isSettled.current = false
      let isCurrent = true

      POST_CAPTCHA()
        .then(function (next) {
          if (isCurrent) updateChallenge(next)
        })
        .catch(function (error) {
          if (!isCurrent) return
          toast.error(HttpError(error).message || '验证码加载失败')
          finish(null)
        })

      return function () {
        isCurrent = false
      }
    },
    [open, epoch]
  )

  function finish(proof: SlideProof | null) {
    if (isSettled.current) return
    isSettled.current = true
    onFinish.current(proof)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={function (next) {
        if (!next) finish(null)
      }}>
      <DialogContent className="w-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>安全验证</DialogTitle>
          <DialogDescription>拖动滑块完成拼图。校验失败后需要重新验证。</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-52 min-w-80 items-center justify-center">
          {challenge ? (
            <GoCaptcha.Slide
              data={{
                image: challenge.masterImage,
                thumb: challenge.thumbImage,
                thumbX: challenge.thumbX,
                thumbY: challenge.thumbY,
                thumbWidth: challenge.thumbWidth,
                thumbHeight: challenge.thumbHeight
              }}
              events={{
                refresh() {
                  updateChallenge(null)
                  updateEpoch(function (current) {
                    return current + 1
                  })
                },
                close() {
                  finish(null)
                },
                confirm(point) {
                  finish({
                    captchaKey: challenge.captchaKey,
                    captchaValue: formatSlideValue(point),
                    captchaKind: challenge.kind
                  })
                }
              }}
            />
          ) : (
            <p className="text-muted-foreground text-sm">正在加载验证码…</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { SlideDialog }
