import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { and, asc, desc, eq, type SQL } from 'drizzle-orm'

import { asset } from '@schema'
import type { CHANNELS } from '@/shared/ipc/channels'
import { IpcError } from '@/shared/ipc/error'
import { type In, type Out } from '@/shared/ipc/specs'
import { findTextureDir } from '@/host/capabilities/capture/path'
import { findClient } from './database'

/**
 * 本地资产仓储（对齐 client `cogito_core::asset`）。
 * 截屏贴图：PNG 落 `textures/`，再 insert 一行，与 Tauri 版共用 cogito-client.db。
 */

type AssetReadR = Out<typeof CHANNELS.ASSET.READ>[number]
type AssetReadP = In<typeof CHANNELS.ASSET.READ>
type AssetWriteP = In<typeof CHANNELS.ASSET.WRITE>
type AssetUpdateP = In<typeof CHANNELS.ASSET.UPDATE>
type AssetRemoveP = In<typeof CHANNELS.ASSET.REMOVE>
type AssetPinP = In<typeof CHANNELS.ASSET.PIN>
type AssetPinR = Out<typeof CHANNELS.ASSET.PIN>
type AssetExportP = In<typeof CHANNELS.ASSET.EXPORT>

function toAsset(row: typeof asset.$inferSelect): AssetReadR {
  return {
    id: row.id,
    tenantID: row.tenantID,
    kind: row.kind,
    hash: row.hash,
    sha: row.sha,
    size: row.size,
    index: row.index,
    mime: row.mime,
    extension: row.extension,
    fileName: row.fileName,
    filePath: row.filePath,
    metadata: row.metadata,
    status: row.status,
    version: row.version,
    deviceID: row.deviceID,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function buildWhere(filter: AssetReadP) {
  if (!filter) return undefined
  const conditions: SQL[] = []
  if (filter.id !== undefined) conditions.push(eq(asset.id, filter.id))
  if (filter.kind !== undefined) conditions.push(eq(asset.kind, filter.kind))
  if (filter.hash !== undefined) conditions.push(eq(asset.hash, filter.hash))
  if (filter.mime !== undefined) conditions.push(eq(asset.mime, filter.mime))
  if (filter.status !== undefined) conditions.push(eq(asset.status, filter.status))
  if (filter.tenantID !== undefined) conditions.push(eq(asset.tenantID, filter.tenantID))
  if (filter.filePath !== undefined) conditions.push(eq(asset.filePath, filter.filePath))
  if (conditions.length === 0) return undefined
  return and(...conditions)
}

async function requireAsset(id: string): Promise<AssetReadR> {
  const rows = await findClient().select().from(asset).where(eq(asset.id, id)).limit(1)
  if (rows.length === 0) {
    throw new IpcError('ASSET_NOT_FOUND', `资产不存在: ${id}`)
  }
  return toAsset(rows[0])
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Buffer } {
  const matched = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl)
  if (!matched) {
    throw new IpcError('ASSET_BAD_PAYLOAD', 'invalid image data URL')
  }
  return {
    mime: matched[1],
    bytes: Buffer.from(matched[2], 'base64')
  }
}

class AssetService {
  async toRead(filter?: AssetReadP): Promise<AssetReadR[]> {
    const db = findClient()
    const where = buildWhere(filter)
    const base = db.select().from(asset)
    const filtered = where ? base.where(where) : base
    const rows = await filtered.orderBy(asc(asset.index), desc(asset.createdAt))
    return rows.map(toAsset)
  }

  async toWrite(input: AssetWriteP): Promise<AssetReadR> {
    const db = findClient()
    const now = Date.now()
    const id = randomUUID()
    await db.insert(asset).values({
      id,
      tenantID: input.tenantID ?? null,
      kind: input.kind ?? null,
      hash: input.hash ?? null,
      sha: input.sha ?? 'sha256',
      size: input.size ?? null,
      index: input.index ?? 1,
      mime: input.mime,
      extension: input.extension || null,
      fileName: input.fileName,
      filePath: input.filePath,
      metadata: input.metadata ?? null,
      status: input.status ?? '001',
      version: input.version ?? 1,
      deviceID: input.deviceID ?? null,
      archivedAt: input.archivedAt ?? null,
      createdAt: now,
      updatedAt: now
    })
    return requireAsset(id)
  }

  async toUpdate(input: AssetUpdateP): Promise<AssetReadR> {
    const db = findClient()
    const patch: Partial<typeof asset.$inferInsert> = { updatedAt: Date.now() }
    if (input.tenantID !== undefined) patch.tenantID = input.tenantID
    if (input.kind !== undefined) patch.kind = input.kind
    if (input.hash !== undefined) patch.hash = input.hash
    if (input.sha) patch.sha = input.sha
    if (input.size !== undefined) patch.size = input.size
    if (input.index !== undefined && input.index !== null) patch.index = input.index
    if (input.mime !== undefined) patch.mime = input.mime
    if (input.extension !== undefined) patch.extension = input.extension || null
    if (input.fileName !== undefined) patch.fileName = input.fileName
    if (input.filePath !== undefined) patch.filePath = input.filePath
    if (input.metadata !== undefined) patch.metadata = input.metadata
    if (input.status) patch.status = input.status
    if (input.version !== undefined && input.version !== null) patch.version = input.version
    if (input.deviceID !== undefined) patch.deviceID = input.deviceID
    if (input.archivedAt !== undefined) patch.archivedAt = input.archivedAt

    await db.update(asset).set(patch).where(eq(asset.id, input.id))
    return requireAsset(input.id)
  }

  async toRemove(input: AssetRemoveP): Promise<void> {
    const rows = await findClient().delete(asset).where(eq(asset.id, input.id)).returning()
    if (rows.length === 0) {
      throw new IpcError('ASSET_NOT_FOUND', `资产不存在: ${input.id}`)
    }
  }

  /**
   * 截屏贴图：data URL → `textures/texture-{ts}.png` + asset 行。
   * 对齐 client `pinTexture`；返回绝对路径供 overlay/磁贴消费。
   */
  async toPin(input: AssetPinP): Promise<AssetPinR> {
    const { mime, bytes } = parseDataUrl(input.dataUrl)
    if (mime !== 'image/png') {
      throw new IpcError('ASSET_BAD_PAYLOAD', `expected image/png, got ${mime}`)
    }

    const dir = findTextureDir()
    await mkdir(dir, { recursive: true })
    const fileName = `texture-${Date.now()}.png`
    const filePath = path.join(dir, fileName)
    await writeFile(filePath, bytes)

    const row = await this.toWrite({
      filePath,
      fileName,
      mime: 'image/png',
      kind: 'image',
      hash: null,
      sha: null,
      size: bytes.byteLength,
      index: null,
      extension: 'png',
      metadata: null,
      status: null,
      deviceID: null,
      archivedAt: null,
      tenantID: null,
      version: null
    })

    return {
      id: row.id,
      filePath,
      fileName,
      size: bytes.byteLength
    }
  }

  /** 用户另存为：只写磁盘，不登记 asset（对齐 client saveToUserPath） */
  async toExport(input: AssetExportP): Promise<void> {
    const { bytes } = parseDataUrl(input.dataUrl)
    await writeFile(input.filePath, bytes)
  }
}

export { AssetService }
export type { AssetReadR, AssetWriteP, AssetPinR }
