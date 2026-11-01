/**
 * 经 Worker 鉴权写对象的共用逻辑：multipart（大文件）与单次 PUT（小 JSON）。
 * upload-via-worker / publish-client 共用。
 */
import { readFileSync } from 'node:fs'
import { open, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PUBLIC_BASE } from '../src/public-base.ts'
import { isPublicKey } from '../src/setup-key.ts'
import { installHttpProxy } from './install-http-proxy.ts'

// 必须在首次 fetch 前装上；国内直连 *.workers.dev 常超时
installHttpProxy()

const PART_MB = 8
const RETRIES = 5
/** R2 的硬约束：非末片最小 5 MiB */
const MIN_PART_MB = 5
const MIB = 1024 * 1024

interface MultipartOptions {
  worker: string
  key: string
  source: string
  authKey: string
  partSizeMb?: number
  retries?: number
}

interface PutOptions {
  worker: string
  key: string
  body: Uint8Array | string
  contentType: string
  authKey: string
  retries?: number
}

/**
 * `--auth-key-file` 可以是只放密钥的文件，也可以直接给 wrangler 的 `.dev.vars`
 * （取 `AUTH_KEY_SECRET=…` 那行的值，去掉可能的引号）。
 */
function parseAuthKey(content: string): string {
  const line = content.split(/\r?\n/).find(function (candidate) {
    return /^\s*(?:export\s+)?AUTH_KEY_SECRET\s*=/.test(candidate)
  })
  const raw = (line === undefined ? content : line.slice(line.indexOf('=') + 1)).trim()
  return raw.replace(/^["']|["']$/g, '')
}

function findAuthKey(explicitPath: string | undefined): string {
  if (explicitPath) {
    return parseAuthKey(readFileSync(explicitPath, 'utf8'))
  }
  const fromEnv = process.env.AUTH_KEY_SECRET?.trim()
  if (fromEnv) {
    return fromEnv
  }
  const fallback = join(tmpdir(), 'cogito-auth-key.txt')
  try {
    return parseAuthKey(readFileSync(fallback, 'utf8'))
  } catch {
    throw new Error(
      `没找到 AUTH_KEY_SECRET：用 --auth-key-file 指定文件，或设环境变量，或写进 ${fallback}`
    )
  }
}

function formatBytes(bytes: number): string {
  if (bytes < MIB) {
    return `${bytes} B`
  }
  return `${(bytes / MIB).toFixed(1)} MiB`
}

function encodeKey(key: string): string {
  return key
    .split('/')
    .map(function (segment) {
      return encodeURIComponent(segment)
    })
    .join('/')
}

function sleep(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

interface RequestInput {
  label: string
  method: string
  url: string
  authKey: string
  retries: number
  body?: Uint8Array | string
  contentType?: string
}

/** 4xx 是客户端问题（密钥错、uploadId 失效），重试没有意义；5xx / 网络错误按 2^n 秒退避重试 */
async function requestJson(input: RequestInput): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    let failure = ''
    let retriable = true
    try {
      const headers: Record<string, string> = { 'X-Custom-Auth-Key': input.authKey }
      if (input.contentType) {
        headers['content-type'] = input.contentType
      }
      const response = await fetch(input.url, {
        method: input.method,
        headers,
        body: input.body
      })
      const text = await response.text()
      if (response.ok) {
        return text.trim() === '' ? null : (JSON.parse(text) as unknown)
      }
      failure = `HTTP ${response.status}: ${text.trim()}`
      retriable = response.status >= 500
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
    if (!retriable || attempt >= input.retries) {
      throw new Error(`${input.label} 失败: ${failure}`)
    }
    const delaySeconds = Math.min(60, 2 ** attempt)
    console.warn(
      `[重试 ${attempt}/${input.retries}] ${input.label}: ${failure}（${delaySeconds}s 后重试）`
    )
    await sleep(delaySeconds * 1000)
  }
}

async function requestOk(input: RequestInput): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    let failure = ''
    let retriable = true
    try {
      const headers: Record<string, string> = { 'X-Custom-Auth-Key': input.authKey }
      if (input.contentType) {
        headers['content-type'] = input.contentType
      }
      const response = await fetch(input.url, {
        method: input.method,
        headers,
        body: input.body
      })
      const text = await response.text()
      if (response.ok) {
        return text
      }
      failure = `HTTP ${response.status}: ${text.trim()}`
      retriable = response.status >= 500
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
    if (!retriable || attempt >= input.retries) {
      throw new Error(`${input.label} 失败: ${failure}`)
    }
    const delaySeconds = Math.min(60, 2 ** attempt)
    console.warn(
      `[重试 ${attempt}/${input.retries}] ${input.label}: ${failure}（${delaySeconds}s 后重试）`
    )
    await sleep(delaySeconds * 1000)
  }
}

function assertPublicKey(key: string): void {
  if (!isPublicKey(key)) {
    throw new Error(
      `对象键 ${key} 不在读侧白名单内（setup.exe / *.msi / nsis.zip / updater-*/latest.json）——` +
        '传上去也下载不了，先对齐名字。'
    )
  }
}

/** 大文件走 multipart；失败自动 mpu-abort */
async function uploadFileViaWorker(options: MultipartOptions): Promise<string> {
  assertPublicKey(options.key)
  const worker = options.worker.replace(/\/+$/, '')
  const partSizeMb = options.partSizeMb ?? PART_MB
  if (!Number.isInteger(partSizeMb) || partSizeMb < MIN_PART_MB) {
    throw new Error(`分片至少 ${MIN_PART_MB} MiB: ${String(partSizeMb)}`)
  }
  const retries = options.retries ?? RETRIES
  const partSizeBytes = partSizeMb * MIB
  const size = (await stat(options.source)).size
  if (size === 0) {
    throw new Error(`源文件是空的: ${options.source}`)
  }

  const base = `${worker}/${encodeKey(options.key)}`
  const partCount = Math.ceil(size / partSizeBytes)
  console.log(`上传 ${options.source}（${formatBytes(size)}）→ ${options.key}`)
  console.log(`端点 ${worker}，分片 ${partSizeMb} MiB × ${partCount}`)

  const created = (await requestJson({
    label: 'mpu-create',
    method: 'POST',
    url: `${base}?action=mpu-create`,
    authKey: options.authKey,
    retries
  })) as { uploadId?: string } | null
  const uploadId = created?.uploadId
  if (!uploadId) {
    throw new Error('mpu-create 没有返回 uploadId')
  }
  console.log(`uploadId=${uploadId}`)

  try {
    const handle = await open(options.source, 'r')
    const parts: { partNumber: number; etag: string }[] = []
    let position = 0
    try {
      const buffer = Buffer.alloc(partSizeBytes)
      while (position < size) {
        const read = (await handle.read(buffer, 0, buffer.length, position)).bytesRead
        if (read <= 0) {
          break
        }
        const partNumber = parts.length + 1
        const part = (await requestJson({
          label: `mpu-uploadpart #${partNumber}`,
          method: 'PUT',
          url: `${base}?action=mpu-uploadpart&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`,
          authKey: options.authKey,
          retries,
          body: buffer.subarray(0, read),
          contentType: 'application/octet-stream'
        })) as { partNumber: number; etag: string }
        parts.push({ partNumber: part.partNumber, etag: part.etag })
        position += read
        console.log(
          `分片 ${partNumber} 完成（${formatBytes(read)}，累计 ${formatBytes(position)}/${formatBytes(size)}）`
        )
      }
    } finally {
      await handle.close()
    }

    const done = await requestJson({
      label: 'mpu-complete',
      method: 'POST',
      url: `${base}?action=mpu-complete&uploadId=${encodeURIComponent(uploadId)}`,
      authKey: options.authKey,
      retries,
      body: JSON.stringify({ parts }),
      contentType: 'application/json'
    })
    console.log(`完成：${JSON.stringify(done)}`)
    return base
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`上传失败：${message}`)
    console.warn(`正在 abort 分片上传（uploadId=${uploadId}）...`)
    try {
      await requestJson({
        label: 'mpu-abort',
        method: 'DELETE',
        url: `${base}?action=mpu-abort&uploadId=${encodeURIComponent(uploadId)}`,
        authKey: options.authKey,
        retries: 1
      })
      console.warn('已 abort，R2 侧不会留下残缺分片。')
    } catch (abortError) {
      const abortMessage = abortError instanceof Error ? abortError.message : String(abortError)
      console.warn(`abort 也失败了（需在 R2 控制台手工清理 uploadId=${uploadId}）：${abortMessage}`)
    }
    throw error
  }
}

/** 小对象（如 latest.json）单次 PUT */
async function putBytesViaWorker(options: PutOptions): Promise<string> {
  assertPublicKey(options.key)
  const worker = options.worker.replace(/\/+$/, '')
  const retries = options.retries ?? RETRIES
  const base = `${worker}/${encodeKey(options.key)}`
  console.log(`PUT → ${options.key}（${options.contentType}）`)
  await requestOk({
    label: 'PUT',
    method: 'PUT',
    url: base,
    authKey: options.authKey,
    retries,
    body: options.body,
    contentType: options.contentType
  })
  return base
}

async function putFileViaWorker(
  options: Omit<PutOptions, 'body'> & { source: string }
): Promise<string> {
  const body = await readFile(options.source)
  return putBytesViaWorker({ ...options, body })
}

export {
  PUBLIC_BASE,
  PART_MB,
  RETRIES,
  MIN_PART_MB,
  findAuthKey,
  encodeKey,
  formatBytes,
  uploadFileViaWorker,
  putBytesViaWorker,
  putFileViaWorker
}
