import { Icon } from '@iconify/react/offline'
import { convertFileSrc } from '@tauri-apps/api/core'

import styles from './agent-sender.module.scss'
import { findAssetPath } from '@/features/agent/model/workspace-path'
import type { FilePartData } from '@/features/agent/types'

interface AgentSenderImagesProps {
  images: FilePartData[]
  disabled?: boolean
  onRemoveImage?: (path: string) => void
}

function AgentSenderImages(props: AgentSenderImagesProps) {
  if (props.images.length === 0) return null

  return (
    <div className={styles.media}>
      <div className={styles.imageStrip}>
        {props.images.map(function (image) {
          return (
            <div
              key={image.path}
              className={styles.imageCard}>
              <div className={styles.imageThumb}>
                <img
                  className={styles.imagePreview}
                  src={convertFileSrc(findAssetPath(image.path))}
                  alt={image.name}
                />
                <button
                  type="button"
                  className={styles.imageRemove}
                  aria-label={`移除 ${image.name}`}
                  disabled={props.disabled}
                  onClick={function (event) {
                    event.preventDefault()
                    event.stopPropagation()
                    props.onRemoveImage?.(image.path)
                  }}>
                  <Icon
                    icon="mdi:close"
                    width={12}
                    height={12}
                  />
                </button>
              </div>
              <span
                className={styles.imageName}
                title={image.name}>
                {image.name}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { AgentSenderImages }
export type { AgentSenderImagesProps }
