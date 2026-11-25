import type { GalleryRow } from '@/views/gallery/model/asset'
import type { GalleryMedia } from '@/views/gallery/model/media'

/**
 * 兼容适配：把 catalog 行转换成旧 `GalleryMedia` 形状。
 *
 * 用途只有一处 —— 复用已经写好并单测过的 `BatchRenameDialog`（它按 `GalleryMedia`
 * 计算「旧名 → 新名」预览）。真正的改名在 Rust 侧执行，读的是数据库里的真实行，
 * 所以这里补齐的字段只要够渲染预览即可，不会回写。
 *
 * 这是**临时桥**：等 `batch-rename-dialog` 换成 catalog 行类型后删掉本文件。
 */
function toLegacyMedia(row: GalleryRow): GalleryMedia {
  return {
    asset: {
      id: row.id,
      tenantID: null,
      kind: row.kind,
      hash: null,
      sha: '',
      size: row.size,
      index: 0,
      mime: row.mime,
      extension: null,
      fileName: row.name,
      filePath: row.path,
      metadata: null,
      status: '029',
      deviceID: null,
      archivedAt: null,
      createdAt: row.capturedAt,
      updatedAt: row.mtimeMs ?? row.capturedAt
    },
    kind: row.kind === 'video' ? 'video' : 'image',
    meta: {
      isManaged: row.isManaged,
      capturedAt: row.capturedAt,
      source: row.source === 'capture' ? 'capture' : 'import'
    },
    capturedAt: row.capturedAt,
    src: ''
  }
}

function toLegacyMedias(rows: GalleryRow[]): GalleryMedia[] {
  return rows.map(toLegacyMedia)
}

export { toLegacyMedia, toLegacyMedias }
