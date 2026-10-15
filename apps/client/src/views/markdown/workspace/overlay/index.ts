import Utility from '@/views/markdown/workspace/overlay/utility.tsx'
import Section from '@/views/markdown/workspace/overlay/section.tsx'
import Navigation from '@/views/markdown/workspace/overlay/navigation.tsx'
import Outline from '@/views/markdown/workspace/overlay/outline.tsx'

/**
 * 内容区工作区部件。
 * Decorations 只放窗口标题 / 应用菜单 / 状态栏，勿把这里的工具塞进 Caption。
 */
const Overlay = {
  Utility,
  Section,
  Navigation,
  Outline
}

export { Overlay }
