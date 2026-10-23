import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根目录（基于本文件位置，不依赖 process.cwd()） */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

/** 本地运行时目录（token、pid、锁文件等） */
export const TMP_DIR = join(ROOT, '.tmp')
