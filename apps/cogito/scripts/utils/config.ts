import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'

/** 仓库根目录（基于本文件位置，不依赖 process.cwd()） */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

/** 本地运行时目录（token、pid、锁文件等） */
export const TMP_DIR = join(ROOT, '.tmp')

type JsonObject = Record<string, unknown>

function readYaml(path: string): JsonObject {
  if (!existsSync(path)) return {}
  const text = readFileSync(path, 'utf8')
  return Bun.YAML.parse(text) as JsonObject
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function deepMerge(base: JsonObject, overlay: JsonObject): JsonObject {
  const out: JsonObject = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    const prev = out[key]
    if (isObject(prev) && isObject(value)) {
      out[key] = deepMerge(prev, value)
    } else {
      out[key] = value
    }
  }
  return out
}

function resolveProfile(base: JsonObject): string {
  const fromEnv = process.env.APP_ENV ?? process.env.RUST_ENV
  if (fromEnv) return fromEnv.toLowerCase()
  const app = base.app
  if (isObject(app) && typeof app.env === 'string') return app.env.toLowerCase()
  return 'development'
}

export type AppConfig = {
  server: { host: string; port: number }
  database: { url: string }
}

let cached: AppConfig | null = null

/** 合并 `config.yaml` → `config.{profile}.yaml` → `config.local.yaml`（与 Rust 加载顺序一致） */
export function loadConfig(): AppConfig {
  if (cached) return cached

  const base = readYaml(join(ROOT, 'config.yaml'))
  const profile = resolveProfile(base)
  const profileYaml = readYaml(join(ROOT, `config.${profile}.yaml`))
  const local = readYaml(join(ROOT, 'config.local.yaml'))
  const merged = deepMerge(deepMerge(base, profileYaml), local)

  const server = merged.server
  const database = merged.database
  cached = {
    server: {
      host: isObject(server) && typeof server.host === 'string' ? server.host : '127.0.0.1',
      port: isObject(server) && typeof server.port === 'number' ? server.port : 3000
    },
    database: {
      // 兜底默认不带密码：本机开发连 Docker 的 cogito-postgres，真实连接串在 config.local.yaml。
      url:
        isObject(database) && typeof database.url === 'string'
          ? database.url
          : 'postgres://machenike:@127.0.0.1:5432/i-thinking'
    }
  }
  return cached
}
