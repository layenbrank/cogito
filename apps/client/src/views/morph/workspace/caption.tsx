import { clsx } from 'clsx'
import { debounce } from 'lodash-es'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Combobox } from '@/components/combobox/index.ts'
import styles from '@/views/morph/workspace/caption.module.scss'
import { useMorphStore } from '@/stores/morph.ts'

/** Morph 窗口顶栏左侧：品牌 · 搜索 */
function Caption() {
  const [visible, onUpdateVisible] = useState(false)
  const toMatchText = useMorphStore(function (s) {
    return s.toMatchText
  })
  const fileName = useMorphStore(function (s) {
    return s.file?.path.split(/[\\/]/).pop() ?? ''
  })

  const debounceUpdate = debounce(function () {
    onUpdateVisible(function (prev) {
      return !prev
    })
  }, 1000)

  const visibleRef = useRef(visible)
  useEffect(
    function () {
      visibleRef.current = visible
    },
    [visible]
  )

  const handleCombobox = useCallback(function (event: MouseEvent) {
    if (!visibleRef.current) return
    const target = event.target as HTMLElement
    if (target.closest('.combobox')) return
    onUpdateVisible(function (prev) {
      return !prev
    })
  }, [])

  async function onUpdateKeyword(value: string) {
    if (value.trim()) await toMatchText(value)
    debounceUpdate()
  }

  useEffect(
    function () {
      window.addEventListener('click', handleCombobox)
      return function () {
        window.removeEventListener('click', handleCombobox)
      }
    },
    [handleCombobox]
  )

  return (
    <div className={clsx(styles.shell)}>
      <div className={styles.brand}>
        <span
          className={styles.logo}
          aria-hidden>
          P
        </span>
        <span className={styles.name}>PDF morph</span>
        {fileName ? <span className={styles.fileName}>{fileName}</span> : null}
      </div>
      <Combobox
        visible={visible}
        onUpdate={onUpdateKeyword}
        placeholder="搜索文字内容 / 页码 / 批注..."
        className={clsx(styles.search)}
        section={
          <Combobox.Series
            options={Array.from({ length: 60 }).map(function (_, index) {
              return {
                label: `搜索结果项 ${index + 1}`,
                value: `result-${index + 1}`,
                key: `result-${index + 1}`
              }
            })}
          />
        }
      />
    </div>
  )
}

export { Caption }
