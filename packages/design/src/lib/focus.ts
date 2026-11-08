/**
 * 全局聚焦环：对齐登录页观感。
 * shadcn 默认 `ring-[3px]` 偏厚，这里统一成 1px，业务侧不必再局部覆盖。
 */
const FOCUS_RING = 'focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40'

/** 成组控件（InputNumber / InputGroup）在子项聚焦时画环 */
const FOCUS_WITHIN = 'focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/40'

const FOCUS_INVALID =
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40'

const FOCUS_WITHIN_INVALID =
  'has-[[aria-invalid=true]]:border-destructive has-[[aria-invalid=true]]:ring-1 has-[[aria-invalid=true]]:ring-destructive/20 dark:has-[[aria-invalid=true]]:ring-destructive/40'

export { FOCUS_INVALID, FOCUS_RING, FOCUS_WITHIN, FOCUS_WITHIN_INVALID }
