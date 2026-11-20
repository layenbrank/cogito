import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'

import { findTheme, subscribeTheme, writeTheme, type ThemeName } from '@/features/appearance/theme.ts'
import { useMirrorStore } from '@/features/mirror/store.ts'
import { ReturnBar } from '@/features/shell/return-bar.tsx'

const THEMES: readonly { value: ThemeName; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

const MAX_WALLPAPER_BYTES = 2_000_000

/** 外观：主题与新标签壁纸。主题写入扩展存储，壁纸写在镜像上。 */
export default function Settings() {
  const mirror = useMirrorStore(function (state) {
    return state.mirror
  })
  const toUpdateWallpaper = useMirrorStore(function (state) {
    return state.toUpdateWallpaper
  })
  const fileRef = useRef<HTMLInputElement>(null)
  const [theme, updateTheme] = useState<ThemeName>(function () {
    return findTheme()
  })
  const [hint, updateHint] = useState<string | null>(null)

  useEffect(function () {
    return subscribeTheme(updateTheme)
  }, [])

  function chooseTheme(next: ThemeName): void {
    updateTheme(next)
    void writeTheme(next).catch(function (error: unknown) {
      console.error('[theme] 切换失败', error)
      updateHint('主题没有保存成功')
    })
  }

  function chooseWallpaper(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (file.size > MAX_WALLPAPER_BYTES) {
      updateHint('图片请小于 2 MB')
      return
    }

    const reader = new FileReader()
    reader.onerror = function () {
      console.error('[wallpaper] 读取失败', reader.error)
      updateHint('壁纸读取失败')
    }
    reader.onload = function () {
      if (typeof reader.result !== 'string') return
      void toUpdateWallpaper(reader.result)
        .then(function () {
          updateHint(null)
        })
        .catch(function (error: unknown) {
          console.error('[wallpaper] 保存失败', error)
          updateHint('壁纸没有保存成功')
        })
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className={clsx('flex h-full justify-center overflow-y-auto p-6')}>
    <div className={clsx('flex h-fit w-full max-w-lg flex-col gap-6 rounded-xl bg-background/80 p-5')}>
      <ReturnBar title="外观" />
      <section className={clsx('flex flex-col gap-2')}>
        <h1 className={clsx('text-base font-medium')}>主题</h1>
        <div className={clsx('flex flex-wrap gap-2')}>
          {THEMES.map(function (item) {
            return (
              <Button
                key={item.value}
                type="button"
                variant={theme === item.value ? 'default' : 'secondary'}
                aria-pressed={theme === item.value}
                onClick={function () {
                  chooseTheme(item.value)
                }}>
                {item.label}
              </Button>
            )
          })}
        </div>
      </section>

      <section className={clsx('flex flex-col gap-2')}>
        <h2 className={clsx('text-base font-medium')}>壁纸</h2>
        <p className={clsx('text-sm text-muted-foreground')}>
          {mirror?.background?.image ? '当前使用自定义壁纸。' : '当前使用内置壁纸。'}
        </p>
        <div className={clsx('flex flex-wrap gap-2')}>
          <Button
            type="button"
            variant="secondary"
            onClick={function () {
              fileRef.current?.click()
            }}>
            更换壁纸
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={function () {
              void toUpdateWallpaper(null).catch(function (error: unknown) {
                console.error('[wallpaper] 清除失败', error)
                updateHint('没能恢复内置壁纸')
              })
            }}>
            恢复内置
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className={clsx('sr-only')}
          aria-label="选择壁纸图片"
          onChange={chooseWallpaper}
        />
      </section>

      {hint ? <p className={clsx('text-sm text-destructive')}>{hint}</p> : null}
    </div>
    </div>
  )
}
