import type { useAui } from '@assistant-ui/react'

import { resolveWorkspacePicks } from '@/features/agent/workspace/paths.ts'

const IMAGE_ACCEPT =
  'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml,image/avif,image/x-icon,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,.ico,.avif'

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif']

type ComposerAui = ReturnType<typeof useAui>

interface WorkspaceAttachResult {
  attached: number
  skipped: string[]
  isMissingWorkspace: boolean
}

async function attachWorkspaceFile(aui: ComposerAui, reference: string) {
  await aui.composer.addAttachment({
    type: 'file',
    name: reference,
    contentType: 'text/plain',
    content: [
      {
        type: 'file',
        filename: reference,
        mimeType: 'text/plain',
        data: ''
      }
    ]
  })
}

function isImageFile(file: { name: string; type: string }) {
  if (file.type.toLowerCase().startsWith('image/')) return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTENSIONS.includes(ext)
}

function readDataUrl(file: File) {
  return new Promise<string>(function (resolve, reject) {
    const reader = new FileReader()
    reader.onload = function () {
      resolve(typeof reader.result === 'string' ? reader.result : '')
    }
    reader.onerror = function () {
      reject(reader.error ?? new Error('读取图片失败'))
    }
    reader.readAsDataURL(file)
  })
}

async function attachImage(aui: ComposerAui, file: File) {
  const data = await readDataUrl(file)
  if (!data.startsWith('data:')) throw new Error('读取图片失败')

  const mediaType = file.type || 'image/png'
  await aui.composer.addAttachment({
    type: 'image',
    name: file.name || 'image',
    contentType: mediaType,
    content: [
      {
        type: 'image',
        image: data,
        filename: file.name || 'image'
      }
    ]
  })
}

/**
 * 附加一张已经是 data URL 的图片。
 *
 * 浏览器面板的截图由 CDP 直接返回 base64，没有 `File` 对象；走这条避免
 * 先转 Blob 再读一遍。
 */
async function attachImageData(aui: ComposerAui, dataUrl: string, name: string) {
  if (!dataUrl.startsWith('data:')) throw new Error('截图数据不合法')
  const separator = dataUrl.indexOf(';')
  const mediaType = separator > 5 ? dataUrl.slice(5, separator) : 'image/png'

  await aui.composer.addAttachment({
    type: 'image',
    name,
    contentType: mediaType,
    content: [
      {
        type: 'image',
        image: dataUrl,
        filename: name
      }
    ]
  })
}

/**
 * 把系统对话框 / 粘贴拿到的绝对路径挂成引用。
 *
 * `roots` 是整个工作区的文件夹（不只是当前那个），`agentRoot` 是会话 cwd：
 * 引用路径按「主文件夹相对、其他文件夹绝对」折算，见 `toAgentPath`。
 */
async function attachWorkspacePaths(
  aui: ComposerAui,
  paths: readonly string[] | null,
  roots: readonly string[],
  agentRoot: string | null
): Promise<WorkspaceAttachResult> {
  if (!paths || paths.length === 0) {
    return { attached: 0, skipped: [], isMissingWorkspace: false }
  }
  if (roots.length === 0) {
    return { attached: 0, skipped: [], isMissingWorkspace: true }
  }

  const picks = resolveWorkspacePicks(paths, roots, agentRoot)
  for (const reference of picks.references) {
    await attachWorkspaceFile(aui, reference)
  }

  return {
    attached: picks.references.length,
    skipped: picks.skipped,
    isMissingWorkspace: false
  }
}

interface PasteAttachResult {
  attached: number
  /** 没接上的文件名（拿不到路径、也不是图片） */
  failed: string[]
}

/**
 * 处理输入框里的粘贴（Ctrl/Cmd+V）：
 *
 * - 图片（截图）→ 读成 dataURL 附件，走模型的多模态通道；
 * - 带绝对路径的文件（资源管理器复制的）→ 按工作区文件引用；
 * - 其余（WebView 拿不到路径的普通文件）→ 收进 `failed`，由调用方提示改用 `+`。
 */
async function attachPastedFiles(
  aui: ComposerAui,
  files: readonly File[],
  roots: readonly string[],
  agentRoot: string | null
): Promise<PasteAttachResult> {
  let attached = 0
  const failed: string[] = []

  for (const file of files) {
    try {
      const absolutePath = (file as File & { path?: string }).path
      if (absolutePath) {
        const result = await attachWorkspacePaths(aui, [absolutePath], roots, agentRoot)
        attached += result.attached
        if (result.attached === 0) failed.push(file.name)
        continue
      }
      if (!isImageFile(file)) {
        failed.push(file.name)
        continue
      }
      await attachImage(aui, file)
      attached += 1
    } catch (error) {
      console.warn('[agent/attachment] 粘贴附件失败:', error)
      failed.push(file.name)
    }
  }

  return { attached, failed }
}

export {
  IMAGE_ACCEPT,
  attachImage,
  attachImageData,
  attachPastedFiles,
  attachWorkspaceFile,
  attachWorkspacePaths,
  isImageFile
}
export type { PasteAttachResult, WorkspaceAttachResult }
