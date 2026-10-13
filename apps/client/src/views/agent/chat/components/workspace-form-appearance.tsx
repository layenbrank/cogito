import { Icon } from '@iconify/react/offline'
import { Input } from '@i-thinking/design/components/input'
import { clsx } from 'clsx'

import styles from './workspace-form.module.scss'
import {
  WORKSPACE_COLORS,
  WORKSPACE_ICONS,
  findWorkspaceIcon
} from '@/features/agent/model/workspace'

interface WorkspaceFormAppearanceProps {
  title: string
  icon: string
  color: string
  onTitleChange: (title: string) => void
  onIconChange: (icon: string) => void
  onColorChange: (color: string) => void
}

function WorkspaceFormAppearance(props: WorkspaceFormAppearanceProps) {
  return (
    <>
      <div className={styles.field}>
        <label
          className={styles.fieldLabel}
          htmlFor="agent-workspace-title">
          工作区名称
        </label>
        <Input
          id="agent-workspace-title"
          placeholder="输入名称..."
          value={props.title}
          onChange={function (event) {
            props.onTitleChange(event.target.value)
          }}
        />
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>工作区图标</div>
        <div className={styles.iconGrid}>
          {WORKSPACE_ICONS.map(function (item) {
            return (
              <button
                key={item.key}
                type="button"
                className={clsx(styles.iconCell, props.icon === item.key && styles.iconActive)}
                aria-label={item.key}
                onClick={function () {
                  props.onIconChange(item.key)
                }}>
                <Icon
                  icon={item.icon}
                  width={18}
                  height={18}
                />
              </button>
            )
          })}
        </div>
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>工作区副色</div>
        <div className={styles.colorRow}>
          {WORKSPACE_COLORS.map(function (swatch) {
            return (
              <button
                key={swatch}
                type="button"
                className={clsx(styles.colorSwatch, props.color === swatch && styles.colorActive)}
                style={{ background: swatch }}
                aria-label={swatch}
                onClick={function () {
                  props.onColorChange(swatch)
                }}>
                {props.color === swatch ? (
                  <Icon
                    icon="lucide:check"
                    width={12}
                    height={12}
                  />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>工作区预览</div>
        <div className={styles.previewFrame}>
          <div className={styles.previewRow}>
            <Icon
              icon="lucide:chevron-down"
              className={styles.previewChevron}
              width={14}
              height={14}
            />
            <span
              className={styles.previewDot}
              style={{ background: props.color }}
            />
            <Icon
              icon={findWorkspaceIcon(props.icon)}
              className={styles.previewIcon}
              width={14}
              height={14}
            />
            <span className={styles.previewTitle}>
              {props.title.trim() || '未命名工作区'}
            </span>
            <Icon
              icon="mdi:dots-horizontal"
              className={styles.previewMore}
              width={16}
              height={16}
            />
          </div>
          <div className={styles.previewSession}>
            <span className={styles.previewSessionBar} />
            <span>新会话将出现在这里</span>
          </div>
        </div>
      </div>
    </>
  )
}

export { WorkspaceFormAppearance }
export type { WorkspaceFormAppearanceProps }
