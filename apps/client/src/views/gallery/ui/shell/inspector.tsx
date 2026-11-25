import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger
} from '@cogito/design/components/select'
import { Icon } from '@iconify/react'
import { useState } from 'react'

import type { AlbumModel } from '@/views/gallery/ui/shell/sidebar'
import type { CuratePatch, GalleryDetails, GalleryLabel, GalleryRow } from '@/views/gallery/model/asset'
import { formatBytes } from '@/views/gallery/model/derive'
import { LABEL_COLORS } from '@/views/gallery/ui/grid/cell'

/**
 * 右侧检查器：评级 / 颜色 / 关键词 / EXIF / 文件信息 + 主要操作。
 *
 * 只对「当前聚焦的那一张」工作 —— 多选时评级/颜色作用于整个选择集，
 * 但元信息仍显示聚焦项，避免出现「12 张照片的 EXIF 混在一起」。
 */
interface InspectorProps {
  row: GalleryRow | null
  details: GalleryDetails | null
  albums: AlbumModel[]
  selectedCount: number
  onCurate: (ids: string[], patch: CuratePatch) => void
  onAddToAlbum: (ids: string[], albumID: string) => void
  /** 当前正在看的相簿（非相簿视图时为 null）：用于“移出本相簿” */
  albumID: string | null
  onDetachFromAlbum: (ids: string[], albumID: string) => void
  onTrash: (ids: string[]) => void
  onFindSimilar: (id: string) => void
  onOpen: (row: GalleryRow) => void
  selectedIDs: string[]
}

const LABELS: GalleryLabel[] = ['red', 'yellow', 'green', 'blue', 'purple']

/** 关键词三分法：新建时默认归到「题材」（人名/地名需要用户自己换 facet 时再说）。 */
const FACET_TEXT: Record<string, string> = {
  people: '人',
  places: '地',
  themes: '题材'
}

function MetaRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-xs">
      <span className="shrink-0 text-muted-foreground">{props.label}</span>
      <span className="min-w-0 break-all text-right">{props.value}</span>
    </div>
  )
}

function Inspector(props: InspectorProps) {
  // 选完相簿立刻回到占位态：下次再选同一个相簿也能触发 onValueChange
  const [pendingAlbum, setPendingAlbum] = useState<string | null>(null)
  const [keywordDraft, setKeywordDraft] = useState('')

  if (!props.row) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
        选中一张照片查看详情
      </div>
    )
  }

  const row = props.row
  const details = props.details
  const targetIDs = props.selectedCount > 1 ? props.selectedIDs : [row.id]

  function findEXIF(): [string, string][] {
    const exif = details?.exif
    if (!exif) return []
    return Object.entries(exif).map(function ([key, value]) {
      return [key, typeof value === 'string' ? value : JSON.stringify(value)]
    })
  }

  const exifRows = findEXIF()

  function addKeyword(): void {
    const value = keywordDraft.trim()
    if (!value) return
    const exists = row.keywords.some(function (item) {
      return item.value === value
    })
    if (!exists) {
      props.onCurate(targetIDs, {
        keywords: [...row.keywords, { facet: 'themes', value }]
      })
    }
    setKeywordDraft('')
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <div>
        <div className="truncate text-sm font-medium" title={row.name}>
          {row.name}
        </div>
        <div className="truncate text-[11px] text-muted-foreground" title={row.path}>
          {row.path}
        </div>
      </div>

      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map(function (value) {
          return (
            <Button
              key={value}
              variant="ghost"
              size="icon"
              title={`${value}★`}
              className={[
                'size-6',
                row.rating >= value ? 'text-amber-500' : 'text-muted-foreground/40'
              ].join(' ')}
              onClick={function () {
                props.onCurate(targetIDs, { rating: row.rating === value ? value - 1 : value })
              }}
            >
              <Icon icon="lucide:star" className="size-4" />
            </Button>
          )
        })}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-1.5 text-[11px]"
          onClick={function () {
            props.onCurate(targetIDs, { rating: 0 })
          }}
        >
          清除
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        {LABELS.map(function (label) {
          return (
            <Button
              key={label}
              variant="ghost"
              size="icon"
              title={label}
              className={[
                'size-5 rounded-full p-0 ring-1 ring-border',
                row.label === label ? 'ring-2 ring-ring' : ''
              ].join(' ')}
              style={{ backgroundColor: LABEL_COLORS[label] }}
              onClick={function () {
                props.onCurate(targetIDs, { label: row.label === label ? null : label })
              }}
            />
          )
        })}
        <Button
          size="sm"
          variant={row.flag === 'rejected' ? 'destructive' : 'ghost'}
          className="ml-1 h-6 px-1.5 text-[11px]"
          onClick={function () {
            props.onCurate(targetIDs, { flag: row.flag === 'rejected' ? null : 'rejected' })
          }}
        >
          拒绝
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-6 px-1.5 text-[11px]"
          title={row.hidden ? '取消隐藏' : '隐藏（默认不出现在网格里）'}
          onClick={function () {
            props.onCurate(targetIDs, { hidden: !row.hidden })
          }}
        >
          <Icon icon={row.hidden ? 'lucide:eye' : 'lucide:eye-off'} className="size-3.5" />
          {row.hidden ? '取消隐藏' : '隐藏'}
        </Button>
      </div>

      {/* 关键词：目录行自带 keywords，增删都走 curate 的全量替换语义 */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <Input
            value={keywordDraft}
            placeholder="加关键词（回车确认，如 妈妈 / 京都）"
            aria-label="加关键词"
            className="h-7 text-xs"
            onChange={function (event) {
              setKeywordDraft(event.target.value)
            }}
            onKeyDown={function (event) {
              if (event.key === 'Enter') {
                event.preventDefault()
                addKeyword()
              }
            }}
          />
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={!keywordDraft.trim()}
            title="加关键词"
            onClick={addKeyword}
          >
            <Icon icon="lucide:plus" className="size-3.5" />
          </Button>
        </div>
        {row.keywords.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.keywords.map(function (keyword) {
              return (
                <Button
                  key={`${keyword.facet}:${keyword.value}`}
                  variant="secondary"
                  size="sm"
                  className="h-5 gap-1 rounded-full px-2 text-[11px] font-normal"
                  title="点击移除"
                  onClick={function () {
                    props.onCurate(targetIDs, {
                      keywords: row.keywords.filter(function (item) {
                        return !(item.facet === keyword.facet && item.value === keyword.value)
                      })
                    })
                  }}
                >
                  {FACET_TEXT[keyword.facet] ?? keyword.facet} · {keyword.value}
                  <Icon icon="lucide:x" className="size-3 opacity-60" />
                </Button>
              )
            })}
          </div>
        ) : null}
      </div>

      <div className="rounded-md border border-border p-2">
        <MetaRow label="类型" value={row.kind} />
        <MetaRow
          label="尺寸"
          value={
            details?.width && details.height ? `${details.width} × ${details.height}` : '—'
          }
        />
        <MetaRow label="体积" value={formatBytes(details?.sizeBytes ?? row.size)} />
        <MetaRow
          label="拍摄时间"
          value={new Date(row.capturedAt).toLocaleString('zh-CN')}
        />
        <MetaRow label="时间来源" value={row.dateSource ?? '—'} />
        {row.probed ? null : <MetaRow label="探测" value="尚未探测（宽高/EXIF 待补）" />}
        {row.missing ? <MetaRow label="状态" value="位置失效" /> : null}
      </div>

      {exifRows.length > 0 ? (
        <div className="rounded-md border border-border p-2">
          <div className="pb-1 text-[11px] font-medium text-muted-foreground">EXIF</div>
          {exifRows.map(function ([key, value]) {
            return <MetaRow key={key} label={key} value={value} />
          })}
        </div>
      ) : null}

      <div className="flex items-center gap-1.5">
        <Select
          size="sm"
          value={pendingAlbum}
          onValueChange={function (value) {
            if (typeof value !== 'string') return
            props.onAddToAlbum(targetIDs, value)
            setPendingAlbum(null)
          }}
        >
          <SelectTrigger className="min-w-0 flex-1" aria-label="加入相簿">
            <span className="truncate text-muted-foreground">加入相簿…</span>
          </SelectTrigger>
          <SelectContent>
            {props.albums.map(function (album) {
              return (
                <SelectItem key={album.id} value={album.id}>
                  {album.name}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-1.5 text-xs"
          onClick={function () {
            props.onFindSimilar(row.id)
          }}
          title="按感知哈希找相似照片（先运行「相似指纹」）"
        >
          <Icon icon="lucide:fingerprint" className="size-3.5" />
          找相似
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-1.5 text-xs"
          onClick={function () {
            props.onOpen(row)
          }}
        >
          <Icon icon="lucide:maximize-2" className="size-3.5" />
          大图
        </Button>
      </div>

      {/* 在相簿视图里才出现：加入了却删不掉是之前的硬伤 */}
      {props.albumID ? (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={function () {
            if (props.albumID) props.onDetachFromAlbum(targetIDs, props.albumID)
          }}
        >
          <Icon icon="lucide:folder-minus" className="size-3.5" />
          从当前相簿移出（{targetIDs.length}）
        </Button>
      ) : null}

      <Button
        variant="destructive"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={function () {
          props.onTrash(targetIDs)
        }}
      >
        <Icon icon="lucide:trash-2" className="size-3.5" />
        移到回收站（{targetIDs.length}）
      </Button>
    </div>
  )
}

export { Inspector }
export type { InspectorProps }
