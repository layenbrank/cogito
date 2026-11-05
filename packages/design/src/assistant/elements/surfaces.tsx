/**
 * assistant-ui 元素共用的样式 token（对应官方 `@/components/assistant-ui/elements/surfaces`）。
 *
 * 元素本体是收费产物，官网只给了示例源码块。这三条 token 的取值是从元素页渲染出的
 * DOM 类名里还原的样式事实，不是抄组件实现 —— 结构、状态与行为都在本仓自写。
 * 这里只放样式常量：任何元素都能 import，改这里等于全体元素一起变。
 */

/** 一块「浅底、无描边」的表面：队列行、待发条目、编辑框都用它 */
const field = 'bg-foreground/[0.04] forced-colors:border dark:bg-foreground/[0.06]'

/** 无底色的图标按钮：悬停才出底色，按下轻微回弹 */
const ghostButton =
  'inline-flex items-center justify-center rounded-full text-muted-foreground outline-hidden transition-[background-color,color,scale] duration-150 hover:bg-foreground/[0.06] hover:text-foreground/90 active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-foreground/20 motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-foreground/[0.09]'

/** 小号等宽标签：条数、状态这类元信息（走本仓字号档位 `text-xs`，不照搬元素页的 px） */
const mono = 'font-mono text-xs tracking-tight text-muted-foreground'

/** 列表行入场：从下方一格淡入（tw-animate-css 提供） */
const rowEnter = 'animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-300'

export { field, ghostButton, mono, rowEnter }
