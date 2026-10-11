import { Icon } from '@iconify/react/offline'

import styles from '@/views/morph/workspace/tasks/tasks.module.scss'

type ConvertFormat = 'png' | 'jpg' | 'docx' | 'xlsx'

interface FormatOption {
  value: ConvertFormat
  label: string
  hint: string
  icon: string
  tone: ConvertFormat
}

interface ScaleOption {
  value: number
  label: string
  detail: string
  hint: string
  tone: 'draft' | 'standard' | 'hd' | 'uhd' | 'print'
  level: 1 | 2 | 3 | 4 | 5
}

const FORMAT_OPTIONS: FormatOption[] = [
  { value: 'png', label: 'PNG', hint: '无损图片', icon: 'mdi:file-png-box', tone: 'png' },
  { value: 'jpg', label: 'JPG', hint: '压缩图片', icon: 'mdi:file-jpg-box', tone: 'jpg' },
  { value: 'docx', label: 'Word', hint: '可编辑文档', icon: 'mdi:file-word-box', tone: 'docx' },
  { value: 'xlsx', label: 'Excel', hint: '表格数据', icon: 'mdi:file-excel-box', tone: 'xlsx' }
]

const SCALE_OPTIONS: ScaleOption[] = [
  { value: 0.5, label: '草稿', detail: '72 DPI', hint: '预览够用', tone: 'draft', level: 1 },
  { value: 1, label: '标准', detail: '144 DPI', hint: '日常分享', tone: 'standard', level: 2 },
  { value: 2, label: '高清', detail: '300 DPI', hint: '屏幕阅读', tone: 'hd', level: 3 },
  { value: 3, label: '超清', detail: '600 DPI', hint: '细节保留', tone: 'uhd', level: 4 },
  { value: 4, label: '印刷', detail: '1200 DPI', hint: '输出打印', tone: 'print', level: 5 }
]

interface ConvertFormatPickerProps {
  format: ConvertFormat
  onChange: (format: ConvertFormat) => void
}

function ConvertFormatPicker(props: ConvertFormatPickerProps) {
  return (
    <div className={styles.optionGroup}>
      <div
        className={styles.formatPicker}
        role="radiogroup"
        aria-label="输出格式">
        {FORMAT_OPTIONS.map(function (option) {
          const isActive = props.format === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              data-active={isActive}
              data-tone={option.tone}
              className={styles.formatOption}
              onClick={function () {
                props.onChange(option.value)
              }}>
              <span
                className={styles.formatBadge}
                aria-hidden>
                <Icon
                  icon={option.icon}
                  width={16}
                  height={16}
                />
              </span>
              <span className={styles.formatText}>
                <span className={styles.formatTitle}>{option.label}</span>
                <span className={styles.formatHint}>{option.hint}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface ConvertScalePickerProps {
  scale: number
  onChange: (scale: number) => void
}

function ConvertScalePicker(props: ConvertScalePickerProps) {
  return (
    <div className={styles.optionGroup}>
      <div
        className={styles.qualityPicker}
        role="radiogroup"
        aria-label="导出质量">
        {SCALE_OPTIONS.map(function (option) {
          const isActive = props.scale === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              title={`${option.label} · ${option.hint}`}
              data-active={isActive}
              data-tone={option.tone}
              data-level={option.level}
              className={styles.qualityOption}
              onClick={function () {
                props.onChange(option.value)
              }}>
              <span
                className={styles.qualityBadge}
                aria-hidden>
                <span className={styles.qualityBars}>
                  {Array.from({ length: 5 }, function (_, index) {
                    return (
                      <span
                        key={index}
                        className={styles.qualityBar}
                        data-on={index < option.level}
                      />
                    )
                  })}
                </span>
              </span>
              <span className={styles.qualityText}>
                <span className={styles.qualityLabel}>{option.label}</span>
                <span className={styles.qualityDetail}>{option.detail}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export { ConvertFormatPicker, ConvertScalePicker }
export type { ConvertFormat }
