#!/usr/bin/env node
/**
 * 走 rclone 的 S3 接口上传（不经过 Worker）：适合没有 Worker 密钥、或想用 rclone 的进度/断点。
 * 需要本机装 rclone；R2 凭据走环境变量（推荐）或参数。
 *
 *   pnpm command distribution upload:rclone --source <文件> --release 1.3.0
 *   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... pnpm ... upload:rclone --source <文件> --release 1.3.0
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { findUploadTarget, parseArgs, runMain } from './upload-args.ts'

const DEFAULT_BUCKET = 'i-thinking'
const DEFAULT_REMOTE = 'cfr2'

const USAGE = `用法: upload-via-rclone --source <文件> (--release <x.y.z> | --key <对象键>) [选项]

选项:
  --source <文件>            要上传的文件（必填）
  --release <x.y.z>          版本目录；默认对象名 i-thinking_<版本>_x64-setup.exe（--version 亦可用）
  --key <对象键>             直接指定整个对象键（与 --release 二选一）
  --name <文件名>            覆盖对象文件名
  --bucket <桶>              默认 ${DEFAULT_BUCKET}
  --account-id <id>          R2 账号 ID（或环境变量 R2_ACCOUNT_ID）
  --access-key-id <id>       （或环境变量 R2_ACCESS_KEY_ID）
  --secret-access-key <key>  （或环境变量 R2_SECRET_ACCESS_KEY）
  --rclone <路径>            rclone 可执行文件（默认从 PATH / 常见安装位置找）
  --remote-name <name>       rclone 远端名，默认 ${DEFAULT_REMOTE}
  --help                     显示本帮助`

function isOnPath(command: string): boolean {
  const probe = spawnSync(command, ['version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32'
  })
  return probe.status === 0
}

/** rclone 不随 Node 一起装：PATH 找不到就按平台常见安装位置找，再不行给安装提示 */
function findRclone(explicitPath: string | undefined): string {
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new Error(`--rclone 指向的文件不存在: ${explicitPath}`)
    }
    return explicitPath
  }
  if (isOnPath('rclone')) {
    return 'rclone'
  }
  const candidates =
    process.platform === 'win32'
      ? [
          join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', 'rclone.exe'),
          join(process.env.ProgramFiles ?? '', 'rclone', 'rclone.exe'),
          join(process.env.LOCALAPPDATA ?? '', 'Programs', 'rclone', 'rclone.exe')
        ]
      : ['/opt/homebrew/bin/rclone', '/usr/local/bin/rclone', '/usr/bin/rclone']
  const found = candidates.find(function (candidate) {
    return candidate && existsSync(candidate)
  })
  if (found) {
    return found
  }
  const hints =
    process.platform === 'win32'
      ? 'winget install Rclone.Rclone'
      : process.platform === 'darwin'
        ? 'brew install rclone'
        : '你的包管理器 / https://rclone.org/install/'
  throw new Error(`没找到 rclone，装一个或用 --rclone 指定路径（${hints}）`)
}

function findCredentials(args: Map<string, string>): {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
} {
  const accountId = args.get('account-id') ?? process.env.R2_ACCOUNT_ID ?? ''
  const accessKeyId = args.get('access-key-id') ?? process.env.R2_ACCESS_KEY_ID ?? ''
  const secretAccessKey = args.get('secret-access-key') ?? process.env.R2_SECRET_ACCESS_KEY ?? ''
  const missing = [
    accountId ? '' : 'account-id（R2_ACCOUNT_ID）',
    accessKeyId ? '' : 'access-key-id（R2_ACCESS_KEY_ID）',
    secretAccessKey ? '' : 'secret-access-key（R2_SECRET_ACCESS_KEY）'
  ].filter(Boolean)
  if (missing.length > 0) {
    throw new Error(
      `缺 R2 凭据: ${missing.join('、')} —— 优先用环境变量，别把密钥写进命令行（会进进程列表）`
    )
  }
  return { accountId, accessKeyId, secretAccessKey }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  if (args.has('help')) {
    console.log(USAGE)
    return
  }

  const { source, key } = findUploadTarget(args, USAGE)

  const bucket = args.get('bucket') ?? DEFAULT_BUCKET
  const remoteName = args.get('remote-name') ?? DEFAULT_REMOTE
  const rclone = findRclone(args.get('rclone'))
  const credentials = findCredentials(args)

  // 配置里带密钥：放临时目录、只给当前用户读，跑完就删
  const workDir = mkdtempSync(join(tmpdir(), 'i-thinking-rclone-'))
  try {
    const configPath = join(workDir, 'rclone.conf')
    writeFileSync(
      configPath,
      [
        `[${remoteName}]`,
        'type = s3',
        'provider = Cloudflare',
        `access_key_id = ${credentials.accessKeyId}`,
        `secret_access_key = ${credentials.secretAccessKey}`,
        `endpoint = https://${credentials.accountId}.r2.cloudflarestorage.com`,
        'acl = private',
        'no_check_bucket = true',
        ''
      ].join('\n'),
      { mode: 0o600 }
    )

    const destination = `${remoteName}:${bucket}/${key}`
    console.log(`上传 ${source} → ${destination}`)
    console.log(`rclone ${rclone}（PATH 分隔符 ${delimiter}）`)
    const result = spawnSync(
      rclone,
      [
        'copyto',
        source,
        destination,
        '--config',
        configPath,
        '--s3-upload-cutoff',
        '100M',
        '--s3-chunk-size',
        '64M',
        '--progress'
      ],
      { stdio: 'inherit', shell: process.platform === 'win32' }
    )
    if (result.status !== 0) {
      throw new Error(`rclone 退出码 ${String(result.status)}`)
    }
    console.log(`完成。对象键 ${key}`)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

await runMain(main)
