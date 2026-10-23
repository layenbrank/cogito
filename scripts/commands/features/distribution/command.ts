import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { Command } from 'commander'

import { logger } from '../../core/logger.ts'
import { REPO_ROOT } from '../../core/paths.ts'
import type { CommandModule } from '../../core/registry.ts'

/**
 * cogito 资源分发端点：它是一个**独立 workspace 包**（`apps/distribution`），本命令只是仓库里的
 * 统一入口 —— 不自己拼 wrangler 参数，工具链（含版本）归那个包的 devDependencies。
 */
const DISTRIBUTION_ROOT = path.join(REPO_ROOT, 'apps', 'distribution')
const DISTRIBUTION_PACKAGE = '@cogito/distribution'

function assertDistributionRoot(): void {
  if (!existsSync(path.join(DISTRIBUTION_ROOT, 'wrangler.jsonc'))) {
    throw new Error(`[distribution] 缺少 ${DISTRIBUTION_ROOT}/wrangler.jsonc`)
  }
}

/** 转发到包内脚本；`args` 原样透传（如上传脚本的 --source / --version） */
function runPackageScript(action: string, script: string, args: string[] = []): void {
  assertDistributionRoot()
  const suffix = args.length > 0 ? ` -- ${args.join(' ')}` : ''
  logger.info(
    `[distribution] ${action} → pnpm --filter ${DISTRIBUTION_PACKAGE} run ${script}${suffix}`
  )
  const result = spawnSync(
    'pnpm',
    ['--filter', DISTRIBUTION_PACKAGE, 'run', script, ...(args.length > 0 ? ['--', ...args] : [])],
    { stdio: 'inherit', shell: true, encoding: 'utf8' }
  )
  if (result.status !== 0) {
    throw new Error(`[distribution] ${script} 退出码 ${result.status}`)
  }
}

/**
 * 上传脚本是相对 `apps/distribution` 跑的（`pnpm --filter` 的 cwd），所以路径类参数先补成绝对路径，
 * 免得用户在仓库根写 `--source dist\x-setup.exe` 却被解析到包目录下。
 */
const PATH_FLAGS = ['--source', '--auth-key-file', '--rclone']

function resolveArgPaths(args: string[]): string[] {
  const resolved: string[] = []
  for (let index = 0; index < args.length; index++) {
    const argument = args[index] ?? ''
    const flag = PATH_FLAGS.find((name) => argument === name || argument.startsWith(`${name}=`))
    if (flag === undefined) {
      resolved.push(argument)
      continue
    }
    if (argument !== flag) {
      resolved.push(`${flag}=${path.resolve(argument.slice(flag.length + 1))}`)
      continue
    }
    const value = args[index + 1]
    resolved.push(argument)
    if (value !== undefined) {
      resolved.push(path.resolve(value))
      index++
    }
  }
  return resolved
}

/** upload 系列原样透传参数（用 --release 指定版本，避免与根命令的 --version 撞车） */
function runUpload(action: string, script: string, cmd: Command): void {
  runPackageScript(action, script, resolveArgPaths((cmd.args as string[]) ?? []))
}

function registerDistribution(program: Command): void {
  const distribution = program
    .command('distribution')
    .description('cogito 资源分发端点（Cloudflare Worker，apps/distribution）')

  distribution
    .command('deploy')
    .description('部署（= apps/distribution 的 `deploy` 脚本）')
    .action(function () {
      runPackageScript('deploy', 'deploy')
    })

  distribution
    .command('dev')
    .description('本地调试（= apps/distribution 的 `dev` 脚本）')
    .action(function () {
      runPackageScript('dev', 'dev')
    })

  distribution
    .command('secret')
    .description('写入密钥 AUTH_KEY_SECRET（= apps/distribution 的 `secret` 脚本）')
    .action(function () {
      runPackageScript('secret', 'secret')
    })

  distribution
    .command('check')
    .description('类型检查（= apps/distribution 的 `type-check` 脚本）')
    .action(function () {
      runPackageScript('check', 'type-check')
      logger.success('[distribution] 类型检查通过')
    })

  distribution
    .command('upload')
    .description('上传安装包：走本端点 multipart（跨平台；= 包内 `upload` 脚本）')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(function (_opts, cmd) {
      runUpload('upload', 'upload', cmd)
    })

  distribution
    .command('upload:rclone')
    .description('上传安装包：走 rclone 的 S3 接口（需本机 rclone + R2 凭据）')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(function (_opts, cmd) {
      runUpload('upload:rclone', 'upload:rclone', cmd)
    })
}

const DistributionCommand: CommandModule = {
  name: 'distribution',
  description: 'cogito 资源分发端点（Cloudflare Worker）',
  register(program) {
    registerDistribution(program)
  }
}

export { DistributionCommand, DISTRIBUTION_ROOT }
