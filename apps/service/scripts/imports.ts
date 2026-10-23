/**
 * 按约定重排 Rust use 导入：std → 外部 → crate/super/self，组间空一行。
 *
 * 用法: pnpm imports
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOTS = [join(ROOT, 'src'), join(ROOT, 'entity', 'src'), join(ROOT, 'migration', 'src')]

const USE_START = /^(pub\s+)?use\s+/

type GroupKey = 'std' | 'ext' | 'crate'

function classify(stmt: string): GroupKey {
  const s = stmt.trimStart()
  let body: string
  if (s.startsWith('pub use ')) {
    body = s.slice('pub use '.length)
  } else {
    body = s.slice('use '.length)
  }
  body = body.trim()
  if (body.startsWith('std::') || body.startsWith('core::') || body.startsWith('alloc::')) {
    return 'std'
  }
  if (body.startsWith('crate::') || body.startsWith('super::') || body.startsWith('self::')) {
    return 'crate'
  }
  if (body.startsWith('{')) {
    const inner = body.slice(1).trimStart()
    if (inner.startsWith('std::') || inner.startsWith('core::') || inner.startsWith('alloc::')) {
      return 'std'
    }
    if (inner.startsWith('crate::') || inner.startsWith('super::') || inner.startsWith('self::')) {
      return 'crate'
    }
    return 'ext'
  }
  return 'ext'
}

function extractUses(lines: string[]): [string[], string[], string[]] {
  let i = 0
  const n = lines.length
  const prefix: string[] = []

  while (i < n) {
    const line = lines[i]
    const stripped = line.trim()
    if (stripped.startsWith('//!') || stripped.startsWith('#![') || stripped.startsWith('#[')) {
      prefix.push(line)
      i++
      continue
    }
    if (stripped === '') {
      let j = i
      while (j < n && lines[j].trim() === '') j++
      if (
        j < n &&
        (USE_START.test(lines[j].trim()) ||
          lines[j].trim().startsWith('//') ||
          lines[j].trim().startsWith('#![') ||
          lines[j].trim().startsWith('#[') ||
          lines[j].trim().startsWith('//!'))
      ) {
        prefix.push(line)
        i++
        continue
      }
      break
    }
    if (stripped.startsWith('//') && !stripped.startsWith('///')) {
      prefix.push(line)
      i++
      continue
    }
    break
  }

  const uses: string[] = []
  while (i < n) {
    const stripped = lines[i].trim()
    if (stripped === '') {
      i++
      continue
    }
    if (stripped.startsWith('//') && !USE_START.test(stripped)) {
      let j = i
      while (j < n && (lines[j].trim().startsWith('//') || lines[j].trim() === '')) j++
      if (j < n && USE_START.test(lines[j].trim())) {
        i = j
      } else {
        break
      }
    }

    if (!USE_START.test(lines[i].trim())) break

    const buf = [lines[i]]
    while (i < n && !buf.join('').includes(';')) {
      i++
      if (i < n) buf.push(lines[i])
    }
    i++
    let stmt = buf.join('')
    if (!stmt.endsWith('\n')) stmt += '\n'
    uses.push(stmt)
    while (i < n && lines[i].trim() === '') i++
  }

  return [prefix, uses, lines.slice(i)]
}

function sortKey(stmt: string): string {
  return stmt.replace('pub use ', 'use ').toLowerCase()
}

function rewrite(path: string): boolean {
  const text = readFileSync(path, 'utf8')
  let content = text.replace(/\r\n/g, '\n')
  if (!content.endsWith('\n')) content += '\n'
  const lines = content.split(/(?<=\n)/)

  const [prefix, uses, rest] = extractUses(lines)
  if (!uses.length) return false

  const groups: Record<GroupKey, string[]> = { std: [], ext: [], crate: [] }
  for (const u of uses) {
    groups[classify(u)].push(u)
  }
  for (const k of Object.keys(groups) as GroupKey[]) {
    groups[k].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
  }

  const out: string[] = []
  out.push(...prefix)
  if (prefix.length && prefix[prefix.length - 1].trim() !== '' && uses.length) {
    out.push('\n')
  }

  let firstGroup = true
  for (const key of ['std', 'ext', 'crate'] as const) {
    const g = groups[key]
    if (!g.length) continue
    if (!firstGroup) out.push('\n')
    firstGroup = false
    for (const stmt of g) {
      out.push(stmt.replace(/\n$/, '') + '\n')
    }
  }

  let restLines = rest
  if (restLines.length) {
    if (out.length && out[out.length - 1].trim() !== '') out.push('\n')
    while (restLines.length && restLines[0].trim() === '') {
      restLines = restLines.slice(1)
    }
    out.push(...restLines)
  }

  const newText = out.join('')
  let oldNorm = text.replace(/\r\n/g, '\n')
  if (!oldNorm.endsWith('\n')) oldNorm += '\n'
  if (newText === oldNorm) return false
  writeFileSync(path, newText, 'utf8')
  return true
}

function walkRs(dir: string): string[] {
  const out: string[] = []
  if (!existsSyncDir(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkRs(full))
    else if (name.endsWith('.rs')) out.push(full)
  }
  return out
}

function existsSyncDir(dir: string): boolean {
  try {
    return statSync(dir).isDirectory()
  } catch {
    return false
  }
}

const changed: string[] = []
for (const root of ROOTS) {
  if (!existsSyncDir(root)) continue
  for (const path of walkRs(root).sort()) {
    try {
      if (rewrite(path)) {
        changed.push(relative(ROOT, path))
      }
    } catch (e) {
      console.log('ERR', path, e)
    }
  }
}

console.log(`changed ${changed.length} files`)
for (const c of changed) console.log(c)
