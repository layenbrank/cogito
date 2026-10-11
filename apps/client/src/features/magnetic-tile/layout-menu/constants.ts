import type { MenuClassNames } from '@/components/contextmenu'
import styles from './layout-menu.module.scss'

/** 磁贴右键菜单样式覆盖 */
const CLASS_NAMES: MenuClassNames = {
  surface: styles.frost,
  submenu: styles.flyout,
  item: styles.row,
  divider: styles.sep
}

export { CLASS_NAMES, styles }
