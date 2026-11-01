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
import { findUploadTarget, parseArgs, runMain } from './upload-args.ts'
import {
  findAuthKey,
  MIN_PART_MB,
  PART_MB,
  PUBLIC_BASE,
  RETRIES,
  uploadFileViaWorker
} from './worker-upload.ts'

const USAGE = `用法: upload-via-worker --source <文件> (--release <x.y.z> | --key <对象键>) [选项]

选项:
  --source <文件>          要上传的文件（必填）
  --release <x.y.z>        版本目录；默认对象名跟源文件 basename（--version 亦可用）
  --name <文件名>          覆盖对象文件名
  --key <对象键>           直接指定整个对象键（与 --release 二选一）
  --worker <base url>      端点地址（默认 ${PUBLIC_BASE}）
  --auth-key-file <文件>   AUTH_KEY_SECRET 所在文件（也可以直接给 .dev.vars）；不给则读环境变量
  --part-size-mb <n>       分片大小，最小 ${MIN_PART_MB}（默认 ${PART_MB}）
  --retries <n>            失败重试次数（4xx 不重试，默认 ${RETRIES}）
  --help                   显示本帮助`

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.has('help')) {
    console.log(USAGE)
    return
  }

  const { source, key } = findUploadTarget(args, USAGE)

  const worker = (args.get('worker') ?? PUBLIC_BASE).replace(/\/+$/, '')
  if (!worker.startsWith('http')) {
    throw new Error(`--worker 要是 http(s) 地址: ${worker}`)
  }
  const partSizeMb = Number(args.get('part-size-mb') ?? PART_MB)
  if (!Number.isInteger(partSizeMb) || partSizeMb < MIN_PART_MB) {
    throw new Error(
      `--part-size-mb 至少 ${MIN_PART_MB}（R2 的非末片最小 5 MiB）: ${String(args.get('part-size-mb'))}`
    )
  }
  const retries = Number(args.get('retries') ?? RETRIES)
  if (!Number.isInteger(retries) || retries < 1) {
    throw new Error(`--retries 至少 1: ${String(args.get('retries'))}`)
  }

  const authKey = findAuthKey(args.get('auth-key-file'))
  const downloadUrl = await uploadFileViaWorker({
    worker,
    key,
    source,
    authKey,
    partSizeMb,
    retries
  })
  console.log(`下载地址：${downloadUrl}`)
}

await runMain(main)
