import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROOT, TMP_DIR } from '../utils/env.ts'
import { Singleton } from '../utils/singleton.ts'

const AUTH_TOKEN_KEY = 'token'
const TOKEN_PATH = join(TMP_DIR, AUTH_TOKEN_KEY)
const LEGACY_TOKEN_PATH = join(ROOT, AUTH_TOKEN_KEY)

function migrateLegacyToken(): void {
  if (!existsSync(LEGACY_TOKEN_PATH) || existsSync(TOKEN_PATH)) return
  mkdirSync(TMP_DIR, { recursive: true })
  renameSync(LEGACY_TOKEN_PATH, TOKEN_PATH)
}

/**
 * 本地登录态 token 读写（落盘到 `.tmp/token`）。
 */
const AuthToken = Singleton()(
  class AuthToken {
    /** 读取 token */
    toRead() {
      migrateLegacyToken()
      try {
        if (!existsSync(TOKEN_PATH)) return ''
        return readFileSync(TOKEN_PATH, 'utf-8').trim()
      } catch {
        return ''
      }
    }

    /** 写入 token */
    toUpdate(token: string) {
      mkdirSync(TMP_DIR, { recursive: true })
      writeFileSync(TOKEN_PATH, token, 'utf-8')
      if (existsSync(LEGACY_TOKEN_PATH)) unlinkSync(LEGACY_TOKEN_PATH)
    }

    /** 清除 token */
    toRemove() {
      if (existsSync(TOKEN_PATH)) unlinkSync(TOKEN_PATH)
      if (existsSync(LEGACY_TOKEN_PATH)) unlinkSync(LEGACY_TOKEN_PATH)
    }
  }
)

const authToken = new AuthToken()

export { AUTH_TOKEN_KEY, AuthToken, authToken }
