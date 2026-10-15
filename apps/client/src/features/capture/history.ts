import { invoke } from '@tauri-apps/api/core'
import { appLocalDataDir, join } from '@tauri-apps/api/path'
import { BaseDirectory, exists, mkdir, writeFile } from '@tauri-apps/plugin-fs'

import { CHANNELS } from '@/shared/ipc/channels'
import {
  parseMeta,
  stringifyMeta,
  type GalleryAsset,
  type GalleryAssetMeta
} from '@/views/gallery/model/media'

interface SessionRecord {
  assetID: string
  filePath: string
  fileName: string
}

interface RecordCaptureInput {
  png: string
  sessionID: string
}

interface InsertResult {
  id: string
}

const CAPTURES_DIR = 'captures'

const sessions = new Map<string, SessionRecord>()

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function findCaptureDir(): Promise<string> {
  if (!(await exists(CAPTURES_DIR, { baseDir: BaseDirectory.AppLocalData }))) {
    await mkdir(CAPTURES_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true })
  }
  const root = await appLocalDataDir()
  return join(root, CAPTURES_DIR)
}

function buildCaptureMeta(
  capturedAt: number,
  previous?: GalleryAssetMeta
): GalleryAssetMeta {
  return {
    source: 'capture',
    isScreenshot: true,
    captureKind: 'screenshot',
    state: 'done',
    isManaged: true,
    capturedAt,
    dateSource: 'capture',
    keep: previous?.keep ?? false,
    albums: previous?.albums ?? []
  }
}

/**
 * 将标注成品写入 captures/，同会话复用一条 asset 记录。
 * 失败只 warn，不抛出。
 */
async function toRecordCapture(input: RecordCaptureInput): Promise<string | null> {
  try {
    const bytes = dataUrlToBytes(input.png)
    const capturedAt = Date.now()
    const existing = sessions.get(input.sessionID)

    if (existing) {
      await writeFile(existing.filePath, bytes)
      let previousMeta: GalleryAssetMeta | undefined
      try {
        const rows = await invoke<GalleryAsset[]>(CHANNELS.ASSET.READ, {
          params: { id: existing.assetID }
        })
        previousMeta = parseMeta(rows[0]?.metadata)
      } catch (error) {
        console.warn('[capture] read existing capture meta failed', error)
      }
      await invoke(CHANNELS.ASSET.UPDATE, {
        params: {
          id: existing.assetID,
          updates: {
            tenantID: null,
            kind: 'image',
            hash: null,
            sha: null,
            size: bytes.byteLength,
            index: null,
            mime: 'image/png',
            extension: 'png',
            fileName: existing.fileName,
            filePath: existing.filePath,
            metadata: stringifyMeta(buildCaptureMeta(capturedAt, previousMeta)),
            status: null,
            deviceID: null,
            archivedAt: null
          }
        }
      })
      return existing.assetID
    }

    const dir = await findCaptureDir()
    const fileName = `screenshot-${capturedAt}.png`
    const filePath = await join(dir, fileName)
    await writeFile(filePath, bytes)

    const inserted = await invoke<InsertResult[]>(CHANNELS.ASSET.INSERT, {
      params: {
        filePath,
        fileName,
        mime: 'image/png',
        kind: 'image',
        hash: null,
        sha: null,
        size: bytes.byteLength,
        index: null,
        extension: 'png',
        metadata: stringifyMeta(buildCaptureMeta(capturedAt)),
        status: null,
        deviceID: null,
        archivedAt: null,
        tenantID: null
      }
    })
    const assetID = inserted[0]?.id
    if (!assetID) {
      console.warn('[capture] history insert returned no id')
      return null
    }
    sessions.set(input.sessionID, { assetID, filePath, fileName })
    return assetID
  } catch (error) {
    console.warn('[capture] toRecordCapture failed', error)
    return null
  }
}

function clearCaptureSession(sessionID: string) {
  sessions.delete(sessionID)
}

function createCaptureSessionID(): string {
  return `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export {
  CAPTURES_DIR,
  clearCaptureSession,
  createCaptureSessionID,
  findCaptureDir,
  toRecordCapture
}
export type { RecordCaptureInput }
