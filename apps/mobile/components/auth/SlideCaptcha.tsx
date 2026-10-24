import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  Pressable,
  Text,
  View,
  useWindowDimensions
} from 'react-native'
import { useTranslation } from 'react-i18next'

import { fetchCaptchaChallenge } from '@/api/auth'
import { useThemeColors } from '@/components/ui/useThemeColors'
import type { CaptchaChallenge, SlideProof } from '@/types/auth'

interface SlideCaptchaModalProps {
  open: boolean
  onFinish: (proof: SlideProof | null) => void
}

/**
 * Formats slide proof as rust-service expects: "x,y".
 */
function formatSlideValue(x: number, y: number) {
  return `${Math.round(x)},${Math.round(y)}`
}

function toDataUri(base64: string) {
  if (base64.startsWith('data:')) {
    return base64
  }
  if (base64.startsWith('/9j/')) {
    return `data:image/jpeg;base64,${base64}`
  }
  return `data:image/png;base64,${base64}`
}

/**
 * Mobile slide captcha modal aligned with Studio go-captcha flow.
 */
function SlideCaptchaModal({ open, onFinish }: SlideCaptchaModalProps) {
  const { t } = useTranslation()
  const colors = useThemeColors()
  const { width: windowWidth } = useWindowDimensions()
  const [challenge, setChallenge] = useState<CaptchaChallenge | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [offsetX, setOffsetX] = useState(0)
  const [epoch, setEpoch] = useState(0)
  const settled = useRef(false)
  const offsetRef = useRef(0)
  const trackWidth = Math.min(320, windowWidth - 48)
  const imageWidth = trackWidth

  const finish = useCallback(
    function (proof: SlideProof | null) {
      if (settled.current) {
        return
      }
      settled.current = true
      onFinish(proof)
    },
    [onFinish]
  )

  useEffect(
    function () {
      if (!open) {
        return
      }
      settled.current = false
      setChallenge(null)
      setError(null)
      setOffsetX(0)
      offsetRef.current = 0
      let active = true

      fetchCaptchaChallenge()
        .then(function (next) {
          if (active) {
            setChallenge(next)
          }
        })
        .catch(function (err) {
          if (!active) {
            return
          }
          setError(err instanceof Error ? err.message : t('captchaLoadFailed'))
        })

      return function () {
        active = false
      }
    },
    [open, epoch, t]
  )

  const maxOffset = useMemo(
    function () {
      if (!challenge) {
        return trackWidth - 48
      }
      return Math.max(8, imageWidth - challenge.thumbWidth)
    },
    [challenge, imageWidth, trackWidth]
  )

  const panResponder = useMemo(
    function () {
      return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove(_event, gesture) {
          const next = Math.max(0, Math.min(maxOffset, gesture.dx))
          offsetRef.current = next
          setOffsetX(next)
        },
        onPanResponderRelease() {
          if (!challenge) {
            return
          }
          finish({
            captchaKey: challenge.captchaKey,
            captchaValue: formatSlideValue(offsetRef.current, challenge.thumbY),
            captchaKind: challenge.kind
          })
        }
      })
    },
    [challenge, finish, maxOffset]
  )

  return (
    <Modal
      animationType="fade"
      transparent
      visible={open}
      onRequestClose={() => finish(null)}>
      <View className="flex-1 items-center justify-center bg-black/50 px-6">
        <View
          className="w-full max-w-sm rounded-2xl p-4"
          style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }}>
          <Text
            className="mb-1 text-lg font-bold"
            style={{ color: colors.text }}>
            {t('captchaTitle')}
          </Text>
          <Text
            className="mb-4 text-sm"
            style={{ color: colors.textSecondary }}>
            {t('captchaHint')}
          </Text>

          {error ? (
            <Text
              className="mb-3 text-sm"
              style={{ color: colors.destructive }}>
              {error}
            </Text>
          ) : null}

          {!challenge && !error ? (
            <View className="h-40 items-center justify-center">
              <ActivityIndicator color={colors.tint} />
              <Text
                className="mt-2 text-sm"
                style={{ color: colors.textSecondary }}>
                {t('captchaLoading')}
              </Text>
            </View>
          ) : null}

          {challenge ? (
            <View className="items-center gap-3">
              <View
                style={{
                  width: imageWidth,
                  height: 160,
                  overflow: 'hidden',
                  borderRadius: 12,
                  backgroundColor: colors.background
                }}>
                <Image
                  resizeMode="cover"
                  source={{ uri: toDataUri(challenge.masterImage) }}
                  style={{ width: imageWidth, height: 160 }}
                />
                <Image
                  resizeMode="contain"
                  source={{ uri: toDataUri(challenge.thumbImage) }}
                  style={{
                    position: 'absolute',
                    left: offsetX,
                    top: challenge.thumbY,
                    width: challenge.thumbWidth,
                    height: challenge.thumbHeight
                  }}
                />
              </View>

              <View
                {...panResponder.panHandlers}
                className="h-12 justify-center rounded-full"
                style={{
                  width: trackWidth,
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.border
                }}>
                <View
                  className="absolute h-10 w-10 items-center justify-center rounded-full"
                  style={{ left: offsetX, backgroundColor: colors.tint }}>
                  <Text className="font-bold text-white">››</Text>
                </View>
              </View>
            </View>
          ) : null}

          <View className="mt-4 flex-row justify-end gap-3">
            <Pressable
              accessibilityRole="button"
              className="min-h-[44px] justify-center px-3"
              onPress={() => finish(null)}>
              <Text style={{ color: colors.textSecondary }}>{t('cancel')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className="min-h-[44px] justify-center px-3"
              onPress={() => {
                setEpoch((value) => value + 1)
              }}>
              <Text style={{ color: colors.tint }}>{t('captchaRefresh')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

/**
 * Imperative slide-captcha helper matching Studio `useSlideProof`.
 */
function useSlideProof() {
  const [isOpen, setOpen] = useState(false)
  const [ticket, setTicket] = useState(0)
  const resolver = useRef<((proof: SlideProof | null) => void) | null>(null)

  function askSlide(): Promise<SlideProof | null> {
    setTicket((value) => value + 1)
    setOpen(true)
    return new Promise(function (resolve) {
      resolver.current = resolve
    })
  }

  function finish(proof: SlideProof | null) {
    setOpen(false)
    const resolve = resolver.current
    resolver.current = null
    resolve?.(proof)
  }

  const dialog = (
    <SlideCaptchaModal
      key={ticket}
      open={isOpen}
      onFinish={finish}
    />
  )

  return { askSlide, dialog }
}

export { SlideCaptchaModal, formatSlideValue, useSlideProof }
