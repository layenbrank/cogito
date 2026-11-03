import { cpSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist')
mkdirSync(out, { recursive: true })

const files = ['manifest.json', 'background.js', 'content.js', 'popup.html', 'popup.js']
for (const name of files) {
  const from = join(root, name)
  if (!existsSync(from)) continue
  cpSync(from, join(out, name))
}

console.log(`[clipper] built → ${out}`)
