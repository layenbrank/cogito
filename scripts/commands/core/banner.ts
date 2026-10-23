import chalk from 'chalk'
import figlet from 'figlet'
import { atlas } from 'gradient-string'

import { logger } from './logger.ts'

function printBanner(title = 'COGITO'): void {
  try {
    const ascii = figlet.textSync(title, {
      font: 'Slant',
      horizontalLayout: 'fitted',
      verticalLayout: 'controlled smushing'
    })
    console.log(`\n${atlas(ascii)}\n`)
  } catch {
    logger.info(chalk.bold(`\n${title} 命令行\n`))
  }
}

export { printBanner }
