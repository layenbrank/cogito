import type { ClockStyle } from '@/stores/clock'

const STYLES: { value: ClockStyle; label: string; hint: string }[] = [
  { value: 'digital', label: '数字', hint: '清晰数字时钟' },
  { value: 'analog', label: '指针', hint: '经典表盘' },
  { value: 'flip', label: '翻页', hint: '立体翻页时钟' },
  { value: 'neon', label: '强调', hint: '主色点缀' },
  { value: 'minimal', label: '极简', hint: '轻量字距' }
]

function findStyleLabel(clockStyle: ClockStyle) {
  return (
    STYLES.find(function (item) {
      return item.value === clockStyle
    })?.label ?? '时钟'
  )
}

export { STYLES, findStyleLabel }
