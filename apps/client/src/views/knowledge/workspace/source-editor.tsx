import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'

import { cn } from 'cn'

import { CODE_THEME, syncCodeTheme, watchCodeTheme } from '@/lib/monaco-theme.ts'
// worker 装配只有一份，见 lib/monaco-environment.ts
import '@/lib/monaco-environment.ts'

interface SourceEditorProps {
  value: string
  fontSize: number
  isDark?: boolean
  onChange: (value: string) => void
  onScrollRatio?: (ratio: number) => void
  scrollRatio?: number
  /** 文档身份；变化时滚到顶部且不恢复旧光标 */
  documentKey?: string | null
  className?: string
}

function SourceEditor(props: SourceEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const suppressingRef = useRef(false)
  const documentKeyRef = useRef(props.documentKey)
  const onChangeRef = useRef(props.onChange)
  const onScrollRef = useRef(props.onScrollRatio)

  useEffect(
    function () {
      onChangeRef.current = props.onChange
      onScrollRef.current = props.onScrollRatio
    },
    [props.onChange, props.onScrollRatio]
  )

  useEffect(
    function () {
      const host = hostRef.current
      if (!host) return

      syncCodeTheme()
      const stopThemeWatch = watchCodeTheme()

      const editor = monaco.editor.create(host, {
        value: props.value,
        language: 'markdown',
        theme: CODE_THEME,
        fontSize: props.fontSize,
        automaticLayout: true,
        wordWrap: 'on',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        lineNumbers: 'on',
        renderLineHighlight: 'line',
        padding: { top: 16, bottom: 16 },
        contextmenu: true
      })
      editorRef.current = editor

      const subChange = editor.onDidChangeModelContent(function () {
        onChangeRef.current(editor.getValue())
      })

      const subScroll = editor.onDidScrollChange(function () {
        if (suppressingRef.current) return
        const top = editor.getScrollTop()
        const height = editor.getScrollHeight() - editor.getLayoutInfo().height
        const ratio = height <= 0 ? 0 : top / height
        onScrollRef.current?.(ratio)
      })

      return function () {
        stopThemeWatch()
        subChange.dispose()
        subScroll.dispose()
        editor.dispose()
        editorRef.current = null
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
    []
  )

  useEffect(
    function () {
      const editor = editorRef.current
      if (!editor) return
      const isDocumentSwitch = documentKeyRef.current !== props.documentKey
      documentKeyRef.current = props.documentKey
      if (!isDocumentSwitch && editor.getValue() === props.value) return
      suppressingRef.current = true
      if (isDocumentSwitch) {
        editor.setValue(props.value)
        editor.setScrollTop(0)
      } else {
        const position = editor.getPosition()
        editor.setValue(props.value)
        if (position) editor.setPosition(position)
        const height = editor.getScrollHeight() - editor.getLayoutInfo().height
        const ratio = props.scrollRatio
        editor.setScrollTop(height <= 0 || ratio == null ? 0 : height * ratio)
      }
      requestAnimationFrame(function () {
        suppressingRef.current = false
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrollRatio 只在灌入时读取；日常同步走下方 effect
    [props.value, props.documentKey]
  )

  useEffect(
    function () {
      // 主题跟随根节点 token；`isDark` 变化时重算一次，防止类名切换没触发观察器
      syncCodeTheme()
    },
    [props.isDark]
  )

  useEffect(
    function () {
      editorRef.current?.updateOptions({ fontSize: props.fontSize })
    },
    [props.fontSize]
  )

  useEffect(
    function () {
      const editor = editorRef.current
      if (!editor || props.scrollRatio === undefined || props.scrollRatio === null) return
      const height = editor.getScrollHeight() - editor.getLayoutInfo().height
      if (height <= 0) return
      suppressingRef.current = true
      editor.setScrollTop(height * props.scrollRatio)
      requestAnimationFrame(function () {
        suppressingRef.current = false
      })
    },
    [props.scrollRatio]
  )

  return (
    <div
      ref={hostRef}
      className={cn('h-full min-h-0 w-full bg-background/93', props.className)}
    />
  )
}

export { SourceEditor }
