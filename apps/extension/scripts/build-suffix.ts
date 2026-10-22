import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

export interface Manifest {
  name: string
  version: string
  incognito: string
  manifest_version: number
  host_permissions: string[]
  description: string
  permissions: string[]
  background: Background
  chrome_url_overrides: Overrides
  externally_connectable: Externally
  web_accessible_resources: Resource[]
}
export interface Background {
  service_worker: string
  content_scripts: Script[]
}

export interface Script {
  matches: string[]
  js: string[]
}

export interface Overrides {
  newtab: string
}

export interface Externally {
  matches: string[]
}

export interface Resource {
  matches: string[]
  resources: string[]
}

const dist = resolve(SCRIPT_DIR, '..', 'dist')
const manifestPath = resolve(dist, 'manifest.json')

type Handler = (manifest: Manifest, file: string) => void

const handlers: Record<string, Handler> = {
  'service-worker': function (manifest, file) {
    console.log('manifest service', file)
    manifest.background.service_worker = basename(file)
  },
  'content-scripts': function (manifest, file) {
    console.log('manifest content', file)

    manifest.background.content_scripts = [
      {
        matches: ['<all_urls>'],
        js: [file]
      }
    ]
  }
}

const libs = Object.keys(handlers)

// 运行时读取：manifest 是构建产物，静态 import 会让 type-check 依赖 dist
async function parseManifest() {
  const content = await readFile(manifestPath, 'utf-8')
  return JSON.parse(content) as Manifest
}

async function runner() {
  const manifest = await parseManifest()
  const files = await readdir(dist, {
    encoding: 'utf-8',
    recursive: true
  })

  for (const file of files) {
    if (!libs.some((lib) => file.includes(lib))) continue

    // service-worker-2TKqLCms.js -> service-worker.js
    // content-scripts-l0sNRNKZ.js -> content-scripts.js

    const filename = basename(file, '.js')
    const replaced = filename.replace(/-([a-zA-Z0-9]{8,})$/, '')
    handlers[replaced]?.(manifest, file)
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { encoding: 'utf-8' })
}

void runner()
