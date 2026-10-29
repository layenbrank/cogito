import { Button } from '@cogito/design/components/button'
import { useEffect, useRef } from 'react'
import * as PIXI from 'pixi.js'

interface WaterRippleProps {
  /** 截图图片元素 */
  sourceImage: HTMLImageElement
  /** 涟漪圆心（归一化 0-1） */
  origin: { x: number; y: number }
  /** 视口尺寸 */
  width: number
  height: number
  /** 动画完成回调 */
  onComplete: () => void
  /** 点击关闭回调 */
  onClose?: () => void
}

/**
 * PixiJS WebGL 水波涟漪动效
 * 使用 DisplacementFilter 实现真实的像素级位移曲变效果
 */
export default function WaterRipple(props: WaterRippleProps) {
  const { sourceImage, origin, width, height, onComplete, onClose } = props
  const containerRef = useRef<HTMLButtonElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const animFrameRef = useRef<number>(0)

  useEffect(
    function () {
      const container = containerRef.current
      if (!container) return

      let destroyed = false
      let app: PIXI.Application | null = null
      let displacementFilter: PIXI.DisplacementFilter | null = null
      let displacementSprite: PIXI.Sprite | null = null
      let displacementTexture: PIXI.Texture | null = null
      let mapCtx: CanvasRenderingContext2D | null = null
      let mapSize = 0
      let cx = 0
      let cy = 0

      // ============ 初始化 PixiJS Application ============

      async function init() {
        if (!container) return
        try {
          console.log('[WaterRipple] mount — component initialized')
          app = new PIXI.Application()
          await app.init({
            width: width,
            height: height,
            backgroundAlpha: 0,
            antialias: false,
            resolution: 1,
            autoDensity: true
          })
          console.log(
            '[WaterRipple] PixiJS app.init() succeeded,',
            app.canvas ? 'canvas OK' : 'NO canvas'
          )

          if (destroyed || !app.canvas) {
            // 组件已卸载或 canvas 不可用，立即清理
            safeDestroyApp()
            onComplete()
            return
          }

          container.appendChild(app.canvas)
          app.canvas.style.position = 'fixed'
          app.canvas.style.left = '0'
          app.canvas.style.top = '0'
          app.canvas.style.pointerEvents = 'none'
          app.canvas.style.zIndex = '300'

          // ============ 创建截图纹理 ============

          const screenshotTexture = PIXI.Texture.from(sourceImage)
          const screenshotSprite = new PIXI.Sprite(screenshotTexture)
          screenshotSprite.width = width
          screenshotSprite.height = height

          // ============ 创建波纹 displacement map ============

          mapSize = 512
          const mapCanvas = document.createElement('canvas')
          mapCanvas.width = mapSize
          mapCanvas.height = mapSize
          mapCtx = mapCanvas.getContext('2d')
          if (!mapCtx) {
            throw new Error('Failed to get 2D context for displacement map')
          }

          // 计算圆心坐标
          cx = origin.x * mapSize
          cy = origin.y * mapSize

          // 初始填充中性灰（不透明），作为 displacement 的零位
          // 关键：整个 map 必须完全不透明，避免 premultiplied alpha 导致 RGB 被清零
          mapCtx.fillStyle = 'rgb(128, 128, 128)'
          mapCtx.fillRect(0, 0, mapSize, mapSize)

          displacementTexture = PIXI.Texture.from(mapCanvas)
          displacementSprite = new PIXI.Sprite(displacementTexture)
          displacementSprite.width = width
          displacementSprite.height = height

          // 创建 DisplacementFilter — scale 足够大以确保可见
          const filterScale = { x: 50, y: 50 }
          displacementFilter = new PIXI.DisplacementFilter({
            sprite: displacementSprite,
            scale: filterScale
          })

          // ============ 添加到舞台 ============

          if (destroyed) {
            safeDestroyApp()
            onComplete()
            return
          }

          app.stage.addChild(screenshotSprite)
          // 注意：displacementSprite 不能添加到 stage！
          // DisplacementFilter 仅读取其纹理作为位移图，渲染它会在截图上叠加半透明覆盖层
          // 注意：filters 赋值必须在 addChild 之后，确保 sprite 已在渲染树中
          screenshotSprite.filters = [displacementFilter]

          // ============ 动画循环 ============

          const duration = 1500 // ms
          const startTime = performance.now()

          function animate() {
            if (
              destroyed ||
              !app ||
              !displacementFilter ||
              !displacementSprite ||
              !displacementTexture ||
              !mapCtx
            ) {
              return
            }

            try {
              const now = performance.now()
              const elapsed = now - startTime
              const progress = Math.min(elapsed / duration, 1)

              // 衰减因子
              const alpha = 1 - progress

              // displacementSprite 保持全不透明，通过 filter scale 衰减位移强度
              displacementSprite.alpha = 1

              // 更新 filter scale（位移强度衰减）
              displacementFilter.scale.x = 50 * alpha
              displacementFilter.scale.y = 50 * alpha

              // 重新绘制 displacement map
              mapCtx.fillStyle = 'rgb(128, 128, 128)'
              mapCtx.fillRect(0, 0, mapSize, mapSize)

              const maxRadius = mapSize * 0.7
              const numRings = 6
              const ringWidth = mapSize * 0.05

              for (let i = 0; i < numRings; i++) {
                const phase = i / numRings
                const ringRadius = ((progress + phase) % 1) * maxRadius

                if (ringRadius < ringWidth * 0.5) continue

                const innerR = Math.max(0, ringRadius - ringWidth)
                const outerR = ringRadius + ringWidth

                mapCtx.save()
                mapCtx.globalAlpha = alpha * 0.95

                const grad = mapCtx.createRadialGradient(cx, cy, innerR, cx, cy, outerR)
                if (i % 2 === 0) {
                  grad.addColorStop(0, 'rgb(128,128,128)')
                  grad.addColorStop(0.5, 'rgb(255,255,255)')
                  grad.addColorStop(1, 'rgb(128,128,128)')
                } else {
                  grad.addColorStop(0, 'rgb(128,128,128)')
                  grad.addColorStop(0.5, 'rgb(0,0,0)')
                  grad.addColorStop(1, 'rgb(128,128,128)')
                }
                mapCtx.fillStyle = grad
                mapCtx.fillRect(0, 0, mapSize, mapSize)
                mapCtx.restore()
              }

              displacementTexture.source.update()

              if (progress < 1) {
                app.ticker.addOnce(animate)
              } else {
                console.log('[WaterRipple] animation complete')
                onComplete()
              }
            } catch (err) {
              console.warn('[WaterRipple] animation error', err)
              onComplete()
            }
          }

          console.log('[WaterRipple] starting animation loop...')
          app.ticker.addOnce(animate)
        } catch (err) {
          console.warn('[WaterRipple] init failed', err)
          safeDestroyApp()
          onComplete()
        }
      }

      /** 安全销毁 PixiJS Application（null-safe） */
      function safeDestroyApp() {
        try {
          if (app) {
            try {
              app.ticker.stop()
            } catch (error) {
              console.debug('[WaterRipple] ticker 已是停止态:', error)
            }
            try {
              if (app.canvas && app.canvas.parentNode) {
                app.canvas.parentNode.removeChild(app.canvas)
              }
            } catch (error) {
              console.debug('[WaterRipple] canvas 已从 DOM 摘除:', error)
            }
            try {
              app.destroy(true, { children: true, texture: true, textureSource: true })
            } catch (error) {
              console.debug('[WaterRipple] destroy 部分失败:', error)
            }
          }
        } catch (error) {
          console.debug('[WaterRipple] 清理整体失败（已忽略）:', error)
        }
        app = null
        displacementFilter = null
        displacementSprite = null
        displacementTexture = null
        mapCtx = null
      }

      // ============ 清理函数 ============

      cleanupRef.current = function () {
        destroyed = true
        cancelAnimationFrame(animFrameRef.current)
        safeDestroyApp()
      }

      void init()

      return function () {
        destroyed = true
        if (cleanupRef.current) {
          cleanupRef.current()
          cleanupRef.current = null
        }
      }
    },
    [sourceImage, origin, width, height, onComplete]
  )

  return (
    <Button
      type="button"
      variant="ghost"
      ref={containerRef}
      aria-label="关闭水波纹"
      onClick={onClose}
      onKeyDown={function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClose?.()
        }
      }}
      className="h-auto w-auto rounded-none border-none bg-transparent p-0 hover:bg-transparent active:bg-transparent"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: onClose ? 'auto' : 'none',
        zIndex: 300,
        border: 'none',
        padding: 0,
        background: 'transparent',
        cursor: onClose ? 'pointer' : 'default'
      }}
    />
  )
}
