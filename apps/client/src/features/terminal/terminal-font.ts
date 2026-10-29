/**
 * WebView2 看不见「仅当前用户」安装的 Nerd Font。
 * Rust `terminal:font` 只回 family + filePath；此处用 plugin-fs 读成 Blob → FontFace。
 * 禁止经 IPC 传数 MB base64（易超时 / FontFace(dataUrl) 在 WebView2 常失败）。
 */
import { readFile } from '@tauri-apps/plugin-fs'
import { Terminal, type TerminalFont } from '@/lib/terminal'
import type { FontWeight } from '@xterm/xterm'

const FALLBACK_FONT_FAMILY = '"Cascadia Mono", "Cascadia Code", Consolas, monospace'

/** 同 family 并发只注入一次 */
const INJECT_TASKS = new Map<string, Promise<boolean>>()

const FONT_WEIGHT_TOKENS = new Set([
  'normal',
  'bold',
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900'
])

function parseFontWeight(weight: string | null | undefined): FontWeight {
  if (!weight) return 'normal'
  const trimmed = weight.trim().toLowerCase()
  if (!trimmed) return 'normal'
  if (trimmed === 'regular') return 'normal'
  if (trimmed === 'light' || trimmed === 'thin' || trimmed === 'extralight') return '300'
  if (trimmed === 'medium') return '500'
  if (trimmed === 'semibold' || trimmed === 'demibold') return '600'
  if (trimmed === 'extrabold' || trimmed === 'black') return '800'
  if (FONT_WEIGHT_TOKENS.has(trimmed)) return trimmed as FontWeight
  const numeric = Number(trimmed)
  if (Number.isFinite(numeric) && numeric > 0) return numeric
  return 'normal'
}

/** xterm fontFamily：注入族名优先，再 Mono / Symbols / 系统等宽 */
function buildFontFamily(faces: string[]): string {
  const unique: string[] = []
  for (const face of faces) {
    const trimmed = face.trim()
    if (!trimmed || unique.includes(trimmed)) continue
    unique.push(trimmed)
  }
  return [...unique.map((face) => `"${face}"`), FALLBACK_FONT_FAMILY].join(', ')
}

/**
 * 路径含 Mono 时，CSS 族名同时挂「原名」与「原名 Mono」，
 * 与 Oh My Posh / WT 配置常见写法对齐。
 */
function facesForInject(primaryFace: string, filePath: string | null): string[] {
  const faces = [primaryFace]
  const pathLooksMono = Boolean(filePath && /mono/i.test(filePath))
  if (pathLooksMono && !/mono/i.test(primaryFace)) {
    faces.unshift(`${primaryFace} Mono`)
  } else if (!/mono/i.test(primaryFace)) {
    faces.push(`${primaryFace} Mono`)
  }
  faces.push('Symbols Nerd Font Mono')
  return faces
}

function injectTerminalFontFace(
  systemFont: TerminalFont,
  cssFaces: string[]
): Promise<boolean> {
  const cacheKey = cssFaces.join('|')
  const pending = INJECT_TASKS.get(cacheKey)
  if (pending) return pending

  const task = bootstrapTerminalFontFace(systemFont, cssFaces)
  INJECT_TASKS.set(cacheKey, task)
  return task
}

async function bootstrapTerminalFontFace(
  systemFont: TerminalFont,
  cssFaces: string[]
): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts) return false

  const filePath = systemFont.filePath?.trim()
  if (!filePath) {
    console.warn('[terminal] terminal:font 无 filePath，无法注入 Nerd Font')
    return false
  }

  let objectUrl: string
  try {
    const bytes = await readFile(filePath)
    const mime = filePath.toLowerCase().endsWith('.otf') ? 'font/otf' : 'font/ttf'
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    const blob = new Blob([copy], { type: mime })
    objectUrl = URL.createObjectURL(blob)
  } catch (error) {
    console.warn('[terminal] 读取字体文件失败', { filePath, error })
    return false
  }

  // Regular 文件按 normal 注册；xterm 的 fontWeight 只影响选字，勿把 medium 绑死到 Face
  const faceOptions = { weight: 'normal', style: 'normal' as const }
  try {
    const registered: string[] = []
    for (const faceName of cssFaces) {
      if (faceName === 'Symbols Nerd Font Mono') continue
      const face = new FontFace(faceName, `url(${objectUrl})`, faceOptions)
      const loaded = await face.load()
      document.fonts.add(loaded)
      // 显式 load：仅 add + ready 时 WebView2 canvas 偶发仍量不到字形
      await document.fonts.load(`12px "${faceName}"`)
      registered.push(faceName)
    }
    await document.fonts.ready
    const checked = registered.filter(function (faceName) {
      return document.fonts.check(`12px "${faceName}"`)
    })
    if (checked.length === 0) {
      console.warn('[terminal] FontFace 已 add 但 document.fonts.check 未通过', {
        faces: cssFaces,
        filePath
      })
      URL.revokeObjectURL(objectUrl)
      return false
    }
    console.info('[terminal] FontFace 已注入(blob)', {
      faces: cssFaces,
      checked,
      filePath,
      objectUrl
    })
    return true
  } catch (error) {
    console.warn('[terminal] Blob FontFace 失败', error)
    URL.revokeObjectURL(objectUrl)
    return false
  }
}

interface TerminalTypeface {
  fontFamily: string
  fontSize: number
  fontWeight: FontWeight
}

/** 读 terminal:font → Blob 注入 → 返回 xterm 字型（必须在 Terminal.open 前完成） */
async function resolveTerminalTypeface(): Promise<TerminalTypeface> {
  let fontFamily = FALLBACK_FONT_FAMILY
  let fontSize = 12
  let fontWeight: FontWeight = 'normal'

  let systemFont: TerminalFont
  try {
    systemFont = await Terminal.font()
  } catch (error) {
    console.warn('[terminal] terminal:font 调用失败，用兜底等宽字体', error)
    return { fontFamily, fontSize, fontWeight }
  }

  const rawFace = systemFont.family?.trim() || null
  // WT/conhost 占位名，不是可加载字体
  const primaryFace =
    rawFace && rawFace !== '__DefaultTTFont__' && rawFace !== 'DefaultTTFont'
      ? rawFace
      : null
  if (!primaryFace && !systemFont.filePath) {
    console.warn('[terminal] terminal:font 未返回有效 family/filePath', {
      family: rawFace
    })
    return { fontFamily, fontSize, fontWeight }
  }

  const injectFace = primaryFace ?? 'MesloLGM Nerd Font Mono'
  const cssFaces = facesForInject(injectFace, systemFont.filePath ?? null)
  fontFamily = buildFontFamily(cssFaces)
  if (systemFont.size && systemFont.size > 0) fontSize = systemFont.size
  fontWeight = parseFontWeight(systemFont.weight)

  const injected = await injectTerminalFontFace(systemFont, cssFaces)
  if (!injected) {
    console.warn('[terminal] 字体注入失败，xterm 将缺 Nerd 图标', {
      family: injectFace,
      filePath: systemFont.filePath ?? null
    })
  }

  return { fontFamily, fontSize, fontWeight }
}

export { resolveTerminalTypeface, FALLBACK_FONT_FAMILY }
export type { TerminalTypeface }
