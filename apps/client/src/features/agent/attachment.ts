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

async function attachWorkspaceFile(aui: ComposerAui, relative: string) {
  await aui.composer.addAttachment({
    type: 'file',
    name: relative,
    contentType: 'text/plain',
    content: [
      {
        type: 'file',
        filename: relative,
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

async function attachWorkspacePaths(
  aui: ComposerAui,
  paths: readonly string[] | null,
  rootPath: string | null
): Promise<WorkspaceAttachResult> {
  if (!paths || paths.length === 0) {
    return { attached: 0, skipped: [], isMissingWorkspace: false }
  }
  if (!rootPath) {
    return { attached: 0, skipped: [], isMissingWorkspace: true }
  }

  const picks = resolveWorkspacePicks(paths, rootPath)
  for (const relative of picks.relatives) {
    await attachWorkspaceFile(aui, relative)
  }

  return {
    attached: picks.relatives.length,
    skipped: picks.skipped,
    isMissingWorkspace: false
  }
}

export { IMAGE_ACCEPT, attachImage, attachWorkspaceFile, attachWorkspacePaths, isImageFile }
export type { WorkspaceAttachResult }
