/**
 * WebView2 看不见「仅当前用户」安装的 Nerd Font。
 * Rust `terminal:font` 只回 family + filePath；此处用 plugin-fs 读成 Blob → FontFace。
 * 禁止经 IPC 传数 MB base64（易超时 / FontFace(dataUrl) 在 WebView2 常失败）。
 *
 * **这里的一切都不能挡住终端出壳**：`resolveTerminalFallbackTypeface()` 是同步的，
 * `resolveTerminalTypeface()` 永远不 reject、且支持超时先返回兜底值 —— 早期版本让
 * `terminal-view` 先 await 这条链才 `new Terminal()`，字体一大就永久白屏。
 */
import { readFile } from '@tauri-apps/plugin-fs'
import { Terminal, type TerminalFont } from '@/lib/terminal'
import type { FontWeight } from '@xterm/xterm'

const FALLBACK_FONT_FAMILY = '"Cascadia Mono", "Cascadia Code", Consolas, monospace'

/**
 * 字体链最长等待：到点先出壳，真正的字型就绪后再升级。
 * 终端是「必须立刻可见」的 UI，字体只影响观感，不该挡住 `new Terminal()`。
 */
const TYPE_FACE_TIMEOUT_MS = 1500

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
  const seen = new Set<string>()
  for (const face of faces) {
    const trimmed = face.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
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

async function registerTerminalCssFace(
  faceName: string,
  objectUrl: string,
  faceOptions: { weight: string; style: 'normal' }
): Promise<string> {
  const face = new FontFace(faceName, `url(${objectUrl})`, faceOptions)
  const loaded = await face.load()
  document.fonts.add(loaded)
  // 显式 load：仅 add 时 WebView2 canvas 偶发仍量不到字形
  await document.fonts.load(`12px "${faceName}"`)
  return faceName
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
    const faceNames = cssFaces.filter(function (faceName) {
      return faceName !== 'Symbols Nerd Font Mono'
    })
    const settled = await Promise.allSettled(
      faceNames.map(function (faceName) {
        return registerTerminalCssFace(faceName, objectUrl, faceOptions)
      })
    )
    const registered: string[] = []
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        registered.push(result.value)
        continue
      }
      console.warn('[terminal] FontFace 注册失败', result.reason)
    }
    /*
     * 不再 `await document.fonts.ready`：CSS Font Loading 的 ready 会等页面上
     * **所有**字体（含尚未用到、尚未落盘的），天然可能长时间不 resolve ——
     * 这条链曾经直接卡住 xterm 的创建，表现为终端永久白屏。
     * 每个 face 已在 registerTerminalCssFace 里单独 load 过，这里只做有限次 check 确认。
     */
    let checked: string[] = []
    for (let attempt = 0; attempt < 3; attempt += 1) {
      checked = registered.filter(function (faceName) {
        return document.fonts.check(`12px "${faceName}"`)
      })
      if (checked.length > 0) break
      await new Promise(function (resolve) {
        window.setTimeout(resolve, 50)
      })
    }
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

interface ResolvedTypeface extends TerminalTypeface {
  /** false = 这是超时兜底值，真正的字型稍后从 `onLate` 回调 */
  isFinal: boolean
}

/**
 * 立刻可用的兜底字型：**不碰 IPC、不读字体文件**。
 *
 * `terminal-view` 必须能同步 `new Terminal()` + `open()`；字体只是观感，
 * 不该成为「终端白屏」的单点。
 */
function resolveTerminalFallbackTypeface(): TerminalTypeface {
  return { fontFamily: FALLBACK_FONT_FAMILY, fontSize: 12, fontWeight: 'normal' }
}

/** 一次启动只解析一遍（含失败结果，避免每开一个 tab 就重读几 MB 字体） */
let typefaceTask: Promise<TerminalTypeface> | null = null

async function computeTerminalTypeface(): Promise<TerminalTypeface> {
  const fallback = resolveTerminalFallbackTypeface()
  let fontFamily = fallback.fontFamily
  let fontSize = fallback.fontSize
  let fontWeight = fallback.fontWeight

  let systemFont: TerminalFont
  try {
    systemFont = await Terminal.font()
  } catch (error) {
    console.warn('[terminal] terminal:font 调用失败，用兜底等宽字体', error)
    return fallback
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
    return fallback
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

function ensureTerminalTypeface(): Promise<TerminalTypeface> {
  if (!typefaceTask) {
    typefaceTask = computeTerminalTypeface().catch(function (error: unknown) {
      console.warn('[terminal] 字型解析异常，用兜底等宽字体', error)
      return resolveTerminalFallbackTypeface()
    })
  }
  return typefaceTask
}

interface ResolveTypefaceOptions {
  /** 超过这个时间先用兜底字型返回；<=0 表示一直等到解析完（测试用） */
  timeoutMs?: number
  /** 超时后真正的字型就绪时回调一次，供视图原地升级（不重建实例） */
  onLate?: (typeface: TerminalTypeface) => void
}

/**
 * 解析 xterm 字型 —— **永不 reject**，且可以带超时。
 *
 * - 正常：`isFinal: true`，直接用；
 * - 超时：先返回兜底字型（`isFinal: false`），后续从 `onLate` 升级；
 * - 失败：返回兜底字型并 `warn`。
 */
async function resolveTerminalTypeface(
  options: ResolveTypefaceOptions = {}
): Promise<ResolvedTypeface> {
  const task = ensureTerminalTypeface()
  const fallback = resolveTerminalFallbackTypeface()
  const timeoutMs = options.timeoutMs ?? TYPE_FACE_TIMEOUT_MS

  if (!(timeoutMs > 0)) {
    const value = await task
    return { ...value, isFinal: true }
  }

  let isFinal = false
  const raced = await Promise.race([
    task.then(function (value) {
      isFinal = true
      return value
    }),
    new Promise<TerminalTypeface>(function (resolve) {
      window.setTimeout(function () {
        resolve(fallback)
      }, timeoutMs)
    })
  ])
  if (isFinal) return { ...raced, isFinal: true }

  console.warn('[terminal] 字体链超过 ' + timeoutMs + 'ms，先用兜底字型出壳')
  if (options.onLate) {
    const late = options.onLate
    void task.then(function (value) {
      late(value)
    })
  }
  return { ...fallback, isFinal: false }
}

export {
  FALLBACK_FONT_FAMILY,
  TYPE_FACE_TIMEOUT_MS,
  resolveTerminalFallbackTypeface,
  resolveTerminalTypeface
}
export type { ResolvedTypeface, ResolveTypefaceOptions, TerminalTypeface }
