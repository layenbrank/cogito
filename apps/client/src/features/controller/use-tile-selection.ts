/**
 * 磁贴墙多选：Ctrl+单击切换、Esc / 空白点击 / 换镜像清空。
 *
 * 按住 Ctrl 时 sortablejs 已被禁用（见 `controller.tsx` 的 `isDisabled`），
 * 所以「Ctrl+单击」天然不会和拖拽重排打架。
 */
import { useCallback, useEffect, useState } from 'react'

function useTileSelection(mirrorID: string | null) {
  const [selected, updateSelected] = useState<ReadonlySet<string>>(function () {
    return new Set<string>()
  })

  // 换镜像清空：跨墙的选择没有意义
  useEffect(
    function () {
      updateSelected(new Set<string>())
    },
    [mirrorID]
  )

  const clear = useCallback(function () {
    updateSelected(function (prev) {
      return prev.size === 0 ? prev : new Set<string>()
    })
  }, [])

  const toggle = useCallback(function (id: string) {
    updateSelected(function (prev) {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Esc 清空：多选没有别的手动退出方式
  useEffect(
    function () {
      if (selected.size === 0) return
      function onKeyDown(event: KeyboardEvent) {
        if (event.key !== 'Escape') return
        // 输入框里的 Esc 是给输入框 / IME 的（关补全、退出输入），不该顺手清掉选区
        const target = event.target
        if (
          target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT')
        ) {
          return
        }
        clear()
      }
      window.addEventListener('keydown', onKeyDown)
      return function () {
        window.removeEventListener('keydown', onKeyDown)
      }
    },
    [selected.size, clear]
  )

  return { selected, clear, toggle }
}

export { useTileSelection }
