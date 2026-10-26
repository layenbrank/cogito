import Utility from '@/views/knowledge/workspace/overlay/utility.tsx'
import Section from '@/views/knowledge/workspace/overlay/section.tsx'
import Navigation from '@/views/knowledge/workspace/overlay/navigation.tsx'
import Outline from '@/views/knowledge/workspace/overlay/outline.tsx'

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
