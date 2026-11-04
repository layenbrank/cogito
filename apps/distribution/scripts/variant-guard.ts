/**
 * 打包档位守卫：发布侧默认只接受**精简版**产物。
 *
 * 为什么在发布侧再拦一道：CI 与本地都可能有人手动 `tauri build` 出完整版，
 * 一路推到 R2 就成了「用户静默拿到 100MB+ 包」。上传前按文件名清点可选件，
 * 只有显式 `--allow-full` 才放行 —— 误传的代价（换包 / 用户重下）远高于多打一次。
 */

/** 只有完整版才会带的工具（与 apps/client/scripts/prepare-binaries.ts 的 FULL_ONLY_RESOURCES 对齐） */
const OPTIONAL_TOOL_FILES = ['pandoc.exe', 'ffmpeg.exe', 'ffprobe.exe'] as const

type ClientVariant = 'slim' | 'full'

/** 档位解析：任何不认识的值都按默认的精简版处理 */
function parseVariant(raw: string | undefined): ClientVariant {
  return (raw ?? '').trim().toLowerCase() === 'full' ? 'full' : 'slim'
}

interface VariantGuardInput {
  variant: ClientVariant
  /** bundle 目录里实际存在的文件名（只取 basename） */
  files: readonly string[]
  /** 显式允许上传完整版 */
  allowFull: boolean
}

type VariantGuardResult = { ok: true } | { ok: false; reason: string }

function checkVariantGuard(input: VariantGuardInput): VariantGuardResult {
  const present = OPTIONAL_TOOL_FILES.filter(function (name) {
    return input.files.includes(name)
  })

  if (input.variant === 'slim' && present.length > 0 && !input.allowFull) {
    return {
      ok: false,
      reason:
        `产物里含完整版才有的大件：${present.join('、')}。\n` +
        '默认只发布精简版。确要发布完整版请加 --allow-full；' +
        '只是想打精简版，请删掉 binaries/ 里的可选件后重新 `pnpm build:client`。'
    }
  }

  if (input.variant === 'full' && present.length !== OPTIONAL_TOOL_FILES.length) {
    const missing = OPTIONAL_TOOL_FILES.filter(function (name) {
      return !input.files.includes(name)
    })
    return {
      ok: false,
      reason:
        `声明了完整版（--variant full），但产物里缺少：${missing.join('、')}。\n` +
        '请用 CLIENT_SIDECAR_VARIANT=full 重新打包。'
    }
  }

  return { ok: true }
}

export { OPTIONAL_TOOL_FILES, checkVariantGuard, parseVariant }
export type { ClientVariant, VariantGuardInput, VariantGuardResult }
