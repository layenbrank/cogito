import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { toast } from 'sonner'

import { HintTooltip } from '@/views/signboard/hint-tooltip'
import styles from '@/views/signboard/signboard.module.scss'
import type { useCardSheet } from '@/views/signboard/use-card-sheet.ts'

type CardSheetDialogAttachProps = Pick<
  ReturnType<typeof useCardSheet>,
  | 'attachRef'
  | 'handleAttachDragOver'
  | 'handleAttachDragLeave'
  | 'handleAttachDrop'
  | 'importing'
  | 'attachImages'
  | 'isAttachDragOver'
  | 'previews'
  | 'openLightbox'
  | 'toPromoteCover'
  | 'toDetachAsset'
  | 'entryID'
>

function CardSheetDialogAttach(props: CardSheetDialogAttachProps) {
  const {
    attachRef,
    handleAttachDragOver,
    handleAttachDragLeave,
    handleAttachDrop,
    importing,
    attachImages,
    isAttachDragOver,
    previews,
    openLightbox,
    toPromoteCover,
    toDetachAsset,
    entryID
  } = props

  return (
    <section
      ref={attachRef}
      className={styles.sheetBlock}
      onDragOver={handleAttachDragOver}
      onDragLeave={handleAttachDragLeave}
      onDrop={handleAttachDrop}>
      <div className={styles.dialogSectionHead}>
        <Icon
          icon="lucide:paperclip"
          className="size-4"
          aria-hidden
        />
        <HintTooltip
          hint="首张为封面；可点选、拖入或 Ctrl+V / ⌘V 粘贴。"
          className={styles.dialogSectionTitle}>
          附件
        </HintTooltip>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={`${styles.cardDialogAction} ${styles.dialogSectionAside}`}
          disabled={importing}
          onClick={function () {
            void attachImages()
          }}>
          <Icon
            icon="lucide:image-plus"
            className="size-3.5"
          />
          {importing ? '导入中…' : '添加'}
        </Button>
      </div>
      {previews.length === 0 ? (
        <Button
          type="button"
          variant="ghost"
          className={
            isAttachDragOver
              ? `${styles.attachEmpty} ${styles.attachEmptyActive}`
              : styles.attachEmpty
          }
          disabled={importing}
          onClick={function () {
            void attachImages()
          }}>
          <Icon
            icon="lucide:image"
            className="size-5 opacity-60"
          />
          <span>
            {isAttachDragOver ? '松开以添加图片' : '点选本机图片，或拖入 / 粘贴截图'}
          </span>
        </Button>
      ) : (
        <ul
          className={
            isAttachDragOver
              ? `${styles.attachGrid} ${styles.attachGridActive}`
              : styles.attachGrid
          }>
          {previews.map(function (item) {
            return (
              <li
                key={item.assetID}
                className={
                  item.isCover
                    ? `${styles.attachItem} ${styles.attachItemCover}`
                    : styles.attachItem
                }>
                <Button
                  type="button"
                  variant="ghost"
                  className={styles.attachThumbBtn}
                  aria-label={`预览 ${item.fileName}`}
                  onClick={function () {
                    openLightbox(item.assetID)
                  }}>
                  <img
                    src={item.src}
                    alt=""
                    className={styles.attachThumb}
                    draggable={false}
                  />
                  <span
                    className={styles.attachThumbHint}
                    aria-hidden>
                    <Icon
                      icon="lucide:expand"
                      className="size-3.5"
                    />
                  </span>
                </Button>
                <div className={styles.attachMeta}>
                  <Button
                    type="button"
                    variant="ghost"
                    className={styles.attachName}
                    title={item.fileName}
                    onClick={function () {
                      openLightbox(item.assetID)
                    }}>
                    {item.fileName}
                  </Button>
                  <div className={styles.attachMetaRow}>
                    {item.isCover ? (
                      <span className={styles.coverBadge}>
                        <Icon
                          icon="lucide:image"
                          className="size-3"
                          aria-hidden
                        />
                        封面
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        className={styles.attachCoverLink}
                        onClick={function () {
                          void toPromoteCover(entryID, item.assetID).then(function (ok) {
                            if (!ok) toast.error('设为封面失败')
                          })
                        }}>
                        设为封面
                      </Button>
                    )}
                  </div>
                </div>
                <div className={styles.attachActions}>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className={styles.attachActionBtn}
                    aria-label={`预览 ${item.fileName}`}
                    onClick={function () {
                      openLightbox(item.assetID)
                    }}>
                    <Icon
                      icon="lucide:eye"
                      className="size-3.5"
                    />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className={`${styles.attachActionBtn} ${styles.attachActionDanger}`}
                    aria-label="移除附件"
                    onClick={function () {
                      void toDetachAsset(entryID, item.assetID).then(function (ok) {
                        if (!ok) toast.error('移除失败')
                      })
                    }}>
                    <Icon
                      icon="lucide:trash-2"
                      className="size-3.5"
                    />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export { CardSheetDialogAttach }
