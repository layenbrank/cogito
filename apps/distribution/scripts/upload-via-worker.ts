#!/usr/bin/env node
/**
 * 通过分发端点的 multipart 接口上传一个大文件（跨平台：Node 24 直接跑 .ts）。
 *
 *   pnpm command distribution upload --source <文件> --release 1.3.0
 *   pnpm --filter @cogito/distribution run upload -- --source <文件> --key 1.3.0/x-setup.exe
 *
 * 鉴权：--auth-key-file（只放密钥的文件，或 wrangler 的 .dev.vars），或环境变量 AUTH_KEY_SECRET，
 * 或 <临时目录>/cogito-auth-key.txt。
 * 任何一步失败都会调 mpu-abort —— 残缺分片不出现在对象列表里，R2 也会在 7 天后自动清（期间占存储）。
 */
import { readFileSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { findUploadTarget, parseArgs, runMain } from './upload-args.ts'

const DEFAULT_WORKER = 'https://cogito-distribution.layenbrank.workers.dev'
const DEFAULT_PART_MB = 8
const DEFAULT_RETRIES = 5
/** R2 的硬约束：非末片最小 5 MiB */
const MIN_PART_MB = 5
const MIB = 1024 * 1024

const USAGE = `用法: upload-via-worker --source <文件> (--release <x.y.z> | --key <对象键>) [选项]

选项:
  --source <文件>          要上传的文件（必填）
  --release <x.y.z>        版本目录；默认对象名 cogito_<版本>_x64-setup.exe（--version 亦可用）
  --name <文件名>          覆盖对象文件名
  --key <对象键>           直接指定整个对象键（与 --release 二选一）
  --worker <base url>      端点地址（默认 ${DEFAULT_WORKER}）
  --auth-key-file <文件>   AUTH_KEY_SECRET 所在文件（也可以直接给 .dev.vars）；不给则读环境变量
  --part-size-mb <n>       分片大小，最小 ${MIN_PART_MB}（默认 ${DEFAULT_PART_MB}）
  --retries <n>            失败重试次数（4xx 不重试，默认 ${DEFAULT_RETRIES}）
  --help                   显示本帮助`

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.has('help')) {
    console.log(USAGE)
    return
  }

  const { source, key } = findUploadTarget(args, USAGE)

  const worker = (args.get('worker') ?? DEFAULT_WORKER).replace(/\/+$/, '')
  if (!worker.startsWith('http')) {
    throw new Error(`--worker 要是 http(s) 地址: ${worker}`)
  }
  const partSizeMb = Number(args.get('part-size-mb') ?? DEFAULT_PART_MB)
  if (!Number.isInteger(partSizeMb) || partSizeMb < MIN_PART_MB) {
    throw new Error(
      `--part-size-mb 至少 ${MIN_PART_MB}（R2 的非末片最小 5 MiB）: ${String(args.get('part-size-mb'))}`
    )
  }
  const retries = Number(args.get('retries') ?? DEFAULT_RETRIES)
  if (!Number.isInteger(retries) || retries < 1) {
    throw new Error(`--retries 至少 1: ${String(args.get('retries'))}`)
  }

  const authKey = findAuthKey(args.get('auth-key-file'))
  const partSizeBytes = partSizeMb * MIB
  const size = (await stat(source)).size
  if (size === 0) {
    throw new Error(`源文件是空的: ${source}`)
  }

  const base = `${worker}/${encodeKey(key)}`
  const partCount = Math.ceil(size / partSizeBytes)
  console.log(`上传 ${source}（${formatBytes(size)}）→ ${key}`)
  console.log(`端点 ${worker}，分片 ${partSizeMb} MiB × ${partCount}`)

  const created = (await requestJson({
    label: 'mpu-create',
    method: 'POST',
    url: `${base}?action=mpu-create`,
    authKey,
    retries
  })) as { uploadId?: string } | null
  const uploadId = created?.uploadId
  if (!uploadId) {
    throw new Error('mpu-create 没有返回 uploadId')
  }
  console.log(`uploadId=${uploadId}`)

  try {
    const handle = await open(source, 'r')
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
          authKey,
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
      authKey,
      retries,
      body: JSON.stringify({ parts }),
      contentType: 'application/json'
    })
    console.log(`完成：${JSON.stringify(done)}`)
    console.log(`下载地址：${base}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`上传失败：${message}`)
    console.warn(`正在 abort 分片上传（uploadId=${uploadId}）...`)
    try {
      await requestJson({
        label: 'mpu-abort',
        method: 'DELETE',
        url: `${base}?action=mpu-abort&uploadId=${encodeURIComponent(uploadId)}`,
        authKey,
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

await runMain(main)
