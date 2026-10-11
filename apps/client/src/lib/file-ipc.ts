/**
 * File 领域 IPC（corex Action：file.read / write / copy / delete）
 */
import { ipcInvoke, parseData } from '@/lib/ipc'
import { DAEMON, DAEMON_ACTION } from '@/shared/ipc/channels'

type FileMode = 'overwrite' | 'replace_between' | 'regex' | 'json_set'

interface FileWriteOptions {
  content?: string
  mode?: FileMode
  start?: string
  end?: string
  pattern?: string
  replacement?: string
  pointer?: string
  value?: unknown
  createDirs?: boolean
  backup?: boolean
}

interface FileWriteResult {
  path: string
  changed: boolean
  bytesWritten: number
}

function toWriteArgs(path: string, options: FileWriteOptions) {
  return {
    path,
    content: options.content,
    mode: options.mode ?? 'overwrite',
    start: options.start,
    end: options.end,
    pattern: options.pattern,
    replacement: options.replacement,
    pointer: options.pointer,
    value: options.value,
    create_dirs: options.createDirs ?? true,
    backup: options.backup ?? false
  }
}

async function read(path: string): Promise<string> {
  const resp = await ipcInvoke(DAEMON.FILE, { path }, DAEMON_ACTION.FILE.READ)
  const data = parseData<unknown>(resp)
  if (typeof data === 'string') return data
  throw new Error('file.read 返回非文本')
}

async function write(path: string, options: FileWriteOptions): Promise<FileWriteResult> {
  const resp = await ipcInvoke(DAEMON.FILE, toWriteArgs(path, options), DAEMON_ACTION.FILE.WRITE)
  const data = parseData<Record<string, unknown>>(resp)
  return {
    path: typeof data.path === 'string' ? data.path : path,
    changed: data.changed === true,
    bytesWritten: typeof data.bytes_written === 'number' ? data.bytes_written : 0
  }
}

async function copy(from: string, to: string): Promise<string> {
  const resp = await ipcInvoke(DAEMON.FILE, { from, to }, DAEMON_ACTION.FILE.COPY)
  return typeof resp.path === 'string' ? resp.path : to
}

async function remove(path: string): Promise<boolean> {
  const resp = await ipcInvoke(DAEMON.FILE, { path }, DAEMON_ACTION.FILE.DELETE)
  return parseData<boolean>(resp)
}

const FileIpc = {
  read,
  write,
  copy,
  remove
}

export { FileIpc }
export type { FileMode, FileWriteOptions, FileWriteResult }
