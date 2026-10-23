import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Skeleton } from '@cogito/design/components/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { clsx } from 'clsx'
import { useState } from 'react'

import styles from '@/views/morph/workspace/navigation.module.scss'
import Thumbnail from '@/views/morph/workspace/thumbnail/thumbnail.tsx'
import { useMorphStore } from '@/stores/morph.ts'

function WorkspaceSection() {
  const toOpenFilePicker = useMorphStore(function (s) {
    return s.toOpenFilePicker
  })
  const toSwitchFile = useMorphStore(function (s) {
    return s.toSwitchFile
  })
  const toCloseFile = useMorphStore(function (s) {
    return s.toCloseFile
  })
  const file = useMorphStore(function (s) {
    return s.file
  })
  const files = useMorphStore(function (s) {
    return s.files
  })

  return (
    <div className={styles.workspaceSection}>
      <div className={styles.workspaceHeader}>
        <span className={styles.workspaceLabel}>工作区</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className={styles.addBtn}
                aria-label="打开 PDF"
                onClick={toOpenFilePicker}
              />
            }>
            <Icon
              icon="mdi:plus"
              className="size-3.5"
            />
          </TooltipTrigger>
          <TooltipContent side="bottom">打开 PDF（支持多选）</TooltipContent>
        </Tooltip>
      </div>

      {files.length === 0 ? (
        <button
          type="button"
          className={styles.emptyCta}
          onClick={toOpenFilePicker}>
          <Icon
            icon="mdi:folder-open"
            width={16}
            height={16}
            className={styles.emptyCtaIcon}
          />
          打开 PDF
        </button>
      ) : (
        <div className={styles.fileList}>
          {files.map(function (f) {
            const name = f.path.split(/[\\/]/).pop() ?? f.path
            const isActive = f.path === file?.path
            return (
              <div
                key={f.path}
                className={clsx(styles.fileItem, isActive && styles.fileItemActive)}>
                <button
                  type="button"
                  className={styles.fileItemMain}
                  onClick={function () {
                    void toSwitchFile(f.path)
                  }}>
                  <span
                    className={styles.fileItemBadge}
                    aria-hidden>
                    <Icon
                      icon="mdi:file-pdf-box"
                      width={18}
                      height={18}
                    />
                  </span>
                  <div className={styles.fileItemBody}>
                    <div className={styles.fileItemName}>{name}</div>
                    <div className={styles.fileItemMeta}>{f.count} 页</div>
                  </div>
                </button>
                <button
                  type="button"
                  className={styles.fileItemClose}
                  aria-label="关闭文件"
                  onClick={function () {
                    toCloseFile(f.path)
                  }}>
                  <Icon
                    icon="ant-design:close-outlined"
                    width={12}
                    height={12}
                  />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PagesSection() {
  const thumbnails = useMorphStore(function (s) {
    return s.thumbnails
  })
  const offset = useMorphStore(function (s) {
    return s.offset
  })
  const annCounts = useMorphStore(function (s) {
    return s.annCounts
  })
  const count = useMorphStore(function (s) {
    return s.file?.count ?? 0
  })
  const toSeekOffset = useMorphStore(function (s) {
    return s.toSeekOffset
  })
  const file = useMorphStore(function (s) {
    return s.file
  })

  if (!file) {
    return (
      <div className={styles.empty}>
        <span>请先打开 PDF</span>
      </div>
    )
  }

  if (!thumbnails.length) {
    return (
      <div className={styles.thumbLoading}>
        {Array.from({ length: Math.min(count, 4) }).map(function (_, i) {
          return (
            <div
              key={i}
              className={styles.skeletonThumb}>
              <Skeleton className="size-full rounded-none" />
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className={styles.thumbnailList}>
      <div className={styles.pageCount}>共 {count} 页</div>
      {thumbnails.map(function (img, index) {
        const thumbOffset = Number.isFinite(img.offset) ? img.offset : index
        return (
          <Thumbnail
            key={`${file.path}:${thumbOffset}`}
            image={img}
            offset={thumbOffset}
            isActive={thumbOffset === offset}
            annotationCount={annCounts[thumbOffset] ?? 0}
            onClick={function () {
              toSeekOffset(thumbOffset, { source: 'thumb' })
            }}
          />
        )
      })}
    </div>
  )
}

export default function Navigation() {
  const [tab, onUpdateTab] = useState<'file' | 'page'>('file')

  return (
    <div className={clsx(styles.navigation, styles.root)}>
      <div className={styles.tabs}>
        <ToggleGroup
          size="sm"
          spacing={0}
          variant="outline"
          value={[tab]}
          className={clsx(styles.tabSegment, 'w-full')}
          onValueChange={function (value) {
            const next = value[0]
            if (next === 'file' || next === 'page') onUpdateTab(next)
          }}>
          <ToggleGroupItem
            value="file"
            className={clsx(styles.segItem, 'gap-2')}>
            <span className={styles.segmentLabel}>
              <span
                className={styles.segBadge}
                data-tone="file"
                aria-hidden>
                <Icon
                  icon="mdi:file-document-box"
                  className="size-3.5"
                />
              </span>
              <span className={styles.segText}>文件</span>
            </span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="page"
            className={clsx(styles.segItem, 'gap-2')}>
            <span className={styles.segmentLabel}>
              <span
                className={styles.segBadge}
                data-tone="page"
                aria-hidden>
                <Icon
                  icon="mdi:view-grid"
                  className="size-3.5"
                />
              </span>
              <span className={styles.segText}>页面</span>
            </span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className={styles.tabContent}>
        {tab === 'file' ? <WorkspaceSection /> : <PagesSection />}
      </div>
    </div>
  )
}
