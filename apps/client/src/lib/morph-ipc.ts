/**
 * Morph（PDF）领域 IPC
 * action 与 Args 变体 kebab 对齐；args / data 与 schema 字段一致
 */
import { ipcInvoke, parseData, parsePath } from '@/lib/ipc'
import { DAEMON, DAEMON_ACTION } from '@/shared/ipc/channels'

type SplitByRanges = {
  ranges: string[]
  limit?: never
}

type SplitByLimit = {
  limit: number
  ranges?: never
}

type SplitOptions = SplitByRanges | SplitByLimit

async function toMeta(path: string): Promise<Morph.Meta> {
  const resp = await ipcInvoke(DAEMON.MORPH, { path }, DAEMON_ACTION.MORPH.META)
  return parseData<Morph.Meta>(resp)
}

async function toRender(path: string, offset: number, scale: number): Promise<Morph.Render> {
  const resp = await ipcInvoke(DAEMON.MORPH, { path, offset, scale }, DAEMON_ACTION.MORPH.RENDER)
  return parseData<Morph.Render>(resp)
}

async function toThumbnails(path: string, scale: number): Promise<Morph.Render[]> {
  const resp = await ipcInvoke(DAEMON.MORPH, { path, scale }, DAEMON_ACTION.MORPH.THUMBNAILS)
  return parseData<Morph.Render[]>(resp)
}

async function toMatch(path: string, query: string): Promise<Morph.Hit[]> {
  const resp = await ipcInvoke(DAEMON.MORPH, { path, query }, DAEMON_ACTION.MORPH.MATCH)
  return parseData<Morph.Hit[]>(resp)
}

async function toExport(src: string, dest: string): Promise<string> {
  const resp = await ipcInvoke(DAEMON.MORPH, { src, dest }, DAEMON_ACTION.MORPH.EXPORT)
  return parsePath(resp)
}

async function toMerge(paths: string[], dest: string): Promise<string> {
  const resp = await ipcInvoke(DAEMON.MORPH, { paths, dest }, DAEMON_ACTION.MORPH.MERGE)
  return parsePath(resp)
}

/** 相邻两页上下拼接为一页；scale 默认 2.0 */
async function toStack(path: string, dest: string, scale = 2): Promise<string> {
  const resp = await ipcInvoke(DAEMON.MORPH, { path, dest, scale }, DAEMON_ACTION.MORPH.STACK)
  return parsePath(resp)
}

/** ranges 与 limit 二选一，统一走 action `split` */
async function toSplit(path: string, dir: string, options: SplitOptions): Promise<string[]> {
  const args =
    'limit' in options && options.limit !== undefined
      ? { path, limit: options.limit, dir }
      : { path, ranges: options.ranges, dir }
  const resp = await ipcInvoke(DAEMON.MORPH, args, DAEMON_ACTION.MORPH.SPLIT)
  return parseData<string[]>(resp)
}

async function toImages(
  path: string,
  scale: number,
  format: string,
  dir: string
): Promise<string[]> {
  const resp = await ipcInvoke(
    DAEMON.MORPH,
    { path, scale, format, dir },
    DAEMON_ACTION.MORPH.IMAGES
  )
  return parseData<string[]>(resp)
}

async function toDocument(path: string, format: string, dir: string): Promise<string> {
  const resp = await ipcInvoke(DAEMON.MORPH, { path, format, dir }, DAEMON_ACTION.MORPH.DOCUMENT)
  return parsePath(resp)
}

async function toReorder(path: string, order: number[], dest: string): Promise<string> {
  const resp = await ipcInvoke(DAEMON.MORPH, { path, order, dest }, DAEMON_ACTION.MORPH.REORDER)
  return parsePath(resp)
}

async function toRotate(
  path: string,
  offsets: number[],
  degrees: number,
  dest: string
): Promise<string> {
  const resp = await ipcInvoke(
    DAEMON.MORPH,
    { path, offsets, degrees, dest },
    DAEMON_ACTION.MORPH.ROTATE
  )
  return parsePath(resp)
}

async function toRemove(path: string, offsets: number[], dest: string): Promise<string> {
  const resp = await ipcInvoke(DAEMON.MORPH, { path, offsets, dest }, DAEMON_ACTION.MORPH.REMOVE)
  return parsePath(resp)
}

async function toExtract(path: string, offsets: number[], dest: string): Promise<string> {
  const resp = await ipcInvoke(DAEMON.MORPH, { path, offsets, dest }, DAEMON_ACTION.MORPH.EXTRACT)
  return parsePath(resp)
}

const MorphIpc = {
  toMeta,
  toRender,
  toThumbnails,
  toMatch,
  toExport,
  toMerge,
  toStack,
  toSplit,
  toImages,
  toDocument,
  toReorder,
  toRotate,
  toRemove,
  toExtract
}

export { MorphIpc }
