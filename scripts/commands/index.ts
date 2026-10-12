#!/usr/bin/env node

import chalk from 'chalk'
import { Command } from 'commander'

import { printBanner } from './core/banner.ts'
import { logger } from './core/logger.ts'
import { registerModules } from './core/registry.ts'
import { DistributionCommand } from './features/distribution/command.ts'
import { SidecarCommand } from './features/sidecar/command.ts'

const FEATURES = [SidecarCommand, DistributionCommand]

process.on('uncaughtException', function (error) {
  if (error.message.includes('User force closed the prompt')) {
    logger.warn('\n已取消操作')
    process.exit(0)
  }
  logger.error(`未捕获异常: ${error.message}`)
  process.exit(1)
})

async function main(): Promise<void> {
  const program = new Command()

  program
    .name('command')
    .description(chalk.cyan('i-thinking 仓库命令行工具'))
    .version('1.1.0', '-v, --version', '显示版本号')
    .option('--no-banner', '不显示启动横幅')
    .helpOption('-h, --help', '显示帮助')

  registerModules(program, FEATURES)

  if (!process.argv.slice(2).length) {
    printBanner('I-THINKING')
    program.help()
    return
  }

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printBanner('I-THINKING')
  }

  await program.parseAsync(process.argv)
}

main().catch(function (error) {
  logger.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
