import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pkg from '../package.json' with { type: 'json' }

const FORGE_DIR = path.dirname(fileURLToPath(import.meta.url))

/** pnpm workspace 根目录 */
const MONOREPO_ROOT = path.resolve(FORGE_DIR, '..', '..', '..')

/** apps/studio 包根目录 */
const PACKAGE_ROOT = path.resolve(FORGE_DIR, '..')

const APP_ID = 'com.cogito.studio'
/** 与 appId 一致；已离开 Squirrel 命名（旧 `com.squirrel.…`） */
const APP_AUMID = APP_ID

const APP_NAME = 'cogito'
const APP_EXECUTABLE = 'cogito'
const APP_VERSION = pkg.version
const APP_DESCRIPTION = pkg.description
const APP_AUTHORS = pkg.author.name
/** 与 Client `bundle.publisher` / 商店「开发者」一致 */
const APP_PUBLISHER = 'layen'
const PRODUCT_NAME = pkg.productName

/**
 * MakerWix / electron-wix-msi 的 UpgradeCode。
 * 未固定时每次 make 会 `randomUUID()`，导致无法覆盖升级——必须钉死。
 * （历史值：由改名前的 appId 派生，与当前 `APP_ID` 解耦，勿重算——
 * 重算会让已安装的老版本无法覆盖升级。）
 */
const WIX_UPGRADE_CODE = '35A339DF-812F-5910-A60F-037F00044BA7'

/** Product/@Language：zh-CN（LCID），对齐 Client NSIS `SimpChinese` 优先 */
const WIX_LANGUAGE = 2052

/** light.exe `-cultures:`，对齐 Client WiX `language: ["zh-CN", "en-US"]` */
const WIX_CULTURES = 'zh-CN;en-US'

/** 开始菜单文件夹，对齐 Client NSIS `startMenuFolder` */
const START_MENU_FOLDER = 'cogito'

export {
  APP_AUMID,
  APP_AUTHORS,
  APP_DESCRIPTION,
  APP_EXECUTABLE,
  APP_ID,
  APP_NAME,
  APP_PUBLISHER,
  APP_VERSION,
  FORGE_DIR,
  MONOREPO_ROOT,
  PACKAGE_ROOT,
  PRODUCT_NAME,
  START_MENU_FOLDER,
  WIX_CULTURES,
  WIX_LANGUAGE,
  WIX_UPGRADE_CODE
}
