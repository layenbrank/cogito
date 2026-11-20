import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

interface Manifest {
  background?: {
    service_worker?: string
  }
}

const dist = resolve(SCRIPT_DIR, '..', 'dist')
const manifestPath = resolve(dist, 'manifest.json')

/** 把 manifest 里的 service worker 指到带 hash 的真实文件名 */
async function runner() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as Manifest
  const files = await readdir(dist, { encoding: 'utf-8', recursive: true })

  const worker =
    files.find(function (file) {
      return /(?:^|[\\/])service-worker\.js$/.test(file)
    }) ??
    files.find(function (file) {
      return /(?:^|[\\/])service-worker-[^\\/]+\.js$/.test(file)
    })

  if (!worker) throw new Error('dist 里没有 service-worker 产物')

  manifest.background = {
    ...manifest.background,
    service_worker: worker.replaceAll('\\', '/')
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { encoding: 'utf-8' })
}

void runner()
