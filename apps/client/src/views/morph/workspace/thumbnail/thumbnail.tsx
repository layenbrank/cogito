import { clsx } from 'clsx'

import styles from './thumbnail.module.scss'

interface ThumbnailProps {
  image: Morph.Render
  offset: number
  isActive: boolean
  annotationCount: number
  offsetLabel?: string
  onClick: () => void
}

export default function Thumbnail(props: ThumbnailProps) {
  const { image, offset, isActive, annotationCount, offsetLabel, onClick } = props

  return (
    <button
      type="button"
      className={clsx(styles.thumbnail, isActive && styles.active)}
      onClick={onClick}>
      <div className={styles.imageWrap}>
        <img
          className={styles.img}
          src={`data:image/png;base64,${image.base64}`}
          alt={`第 ${offset + 1} 页`}
          draggable={false}
        />
        {annotationCount > 0 ? (
          <span className={styles.badge} aria-label={`${annotationCount} 条批注`}>
            {annotationCount}
          </span>
        ) : null}
      </div>
      <div className={styles.meta}>
        <span className={styles.pageNum}>{offset + 1}</span>
        {offsetLabel ? <span className={styles.pageLabel}>{offsetLabel}</span> : null}
      </div>
    </button>
  )
}
