import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'

import { PageBoard } from '@/views/morph/workspace/tasks/stage/page-board.tsx'
import styles from '@/views/morph/workspace/tasks/tasks.module.scss'

interface ConvertPreviewProps {
  hasFile: boolean
  isImage: boolean
  pageCount: number
  previewImage: Morph.Render | null
  isSampleLoading: boolean
  thumbnails: Morph.Render[]
  thumbnailsError: string | null
  onOpenFile: () => void
  onRetryThumbnails: () => void
}

function ConvertPreview(props: ConvertPreviewProps) {
  if (!props.hasFile) {
    return (
      <div className={styles.stageEmpty}>
        <div className={styles.notice}>
          <Icon
            icon="ant-design:info-circle-outlined"
            className="size-4"
          />
          <span className={styles.noticeText}>请先打开一个 PDF，再进行转换</span>
          <Button
            variant="link"
            size="sm"
            onClick={props.onOpenFile}>
            打开 PDF
          </Button>
        </div>
      </div>
    )
  }

  if (!props.isImage) {
    return (
      <PageBoard
        thumbnails={props.thumbnails}
        count={props.pageCount}
        isLoading={!props.thumbnailsError && props.thumbnails.length === 0}
        hasError={Boolean(props.thumbnailsError)}
        onRetry={props.onRetryThumbnails}
      />
    )
  }

  return (
    <div className={styles.sampleStage}>
      {props.previewImage ? (
        <img
          className={styles.sampleHero}
          src={`data:image/png;base64,${props.previewImage.base64}`}
          alt="转换首页预览"
        />
      ) : (
        <p className={styles.help}>{props.isSampleLoading ? '正在渲染预览…' : '暂无预览'}</p>
      )}
      {props.thumbnails.length > 0 ? (
        <div className={styles.sampleStrip}>
          {props.thumbnails.slice(0, 8).map(function (image) {
            return (
              <img
                key={image.offset}
                className={styles.stripThumb}
                src={`data:image/png;base64,${image.base64}`}
                alt={`第 ${image.offset + 1} 页`}
              />
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export { ConvertPreview }
