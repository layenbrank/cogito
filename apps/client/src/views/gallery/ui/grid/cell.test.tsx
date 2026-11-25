import '@testing-library/jest-dom/vitest'
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GalleryCell } from '@/views/gallery/ui/grid/cell'
import type { GalleryRow } from '@/views/gallery/model/asset'

vi.mock('@tauri-apps/api/core', function () {
  return {
    convertFileSrc: function (path: string) {
      return `http://thumb.localhost/${encodeURIComponent(path)}`
    }
  }
})

// 离线图标集在 jsdom 里很贵，用例只关心媒体元素
vi.mock('@iconify/react', function () {
  return {
    Icon: function StubIcon(props: { icon: string }) {
      return <span data-icon={props.icon} />
    }
  }
})

function toRow(patch: Partial<GalleryRow>): GalleryRow {
  return {
    id: 'asset-1',
    kind: 'image',
    name: 'a.jpg',
    path: 'D:/photos/a.jpg',
    mime: 'image/jpeg',
    capturedAt: 1_700_000_000_000,
    dateSource: null,
    rating: 0,
    flag: null,
    label: null,
    size: null,
    width: 800,
    height: 600,
    durationMs: null,
    stackID: null,
    dupGroup: null,
    missing: false,
    hidden: false,
    albumIDs: [],
    keywords: [],
    source: null,
    captureKind: null,
    isManaged: false,
    keep: false,
    mtimeMs: 1_700_000_000_000,
    probed: true,
    ...patch
  }
}

function renderCell(row: GalleryRow) {
  return render(
    <GalleryCell
      row={row}
      columns={5}
      isSelected={false}
      isActive={false}
      isSelecting={false}
      onActivate={function () {}}
      onOpen={function () {}}
    />
  )
}

describe('GalleryCell 缩略图回落', function () {
  it('视频缩略图解码失败后改用 <video> 首帧，而不是把原片塞进 <img>', function () {
    const { container } = renderCell(toRow({ kind: 'video', mime: 'video/mp4', durationMs: 5_000 }))

    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toContain(encodeURIComponent('/t/asset-1/'))

    fireEvent.error(image as HTMLImageElement)

    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video?.getAttribute('src')).toContain(encodeURIComponent('/o/asset-1/'))
    expect(video?.getAttribute('src')).toContain('#t=0.1')
    expect(container.querySelector('img')).toBeNull()
  })

  it('图片缩略图失败仍回原图（HEIC/RAW 由后端兜底）', function () {
    const { container } = renderCell(toRow({ kind: 'image' }))

    const image = container.querySelector('img')
    fireEvent.error(image as HTMLImageElement)

    const next = container.querySelector('img')
    expect(next?.getAttribute('src')).toContain(encodeURIComponent('/o/asset-1/'))
    expect(container.querySelector('video')).toBeNull()
  })

  it('视频首帧也解不开时不留下黑块（回到底色 + 图标）', function () {
    const { container } = renderCell(toRow({ kind: 'video', mime: 'video/mp4' }))

    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    fireEvent.error(container.querySelector('video') as HTMLVideoElement)

    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[data-icon="lucide:film"]')).not.toBeNull()
  })
})
