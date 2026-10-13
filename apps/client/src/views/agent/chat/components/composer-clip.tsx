import { Icon } from '@iconify/react/offline'
import { useAui } from '@assistant-ui/react'
import { Button } from '@i-thinking/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@i-thinking/design/components/tooltip'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'

import {
  IMAGE_ACCEPT,
  attachImage,
  attachWorkspacePaths,
  isImageFile
} from '@/features/agent/attachment.ts'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'

/** 输入区左下角回形针：图片 / 工作区文件 / 文件夹 */
function ComposerClip() {
  const aui = useAui()
  const { primaryPath } = useActiveWorkspace()

  function reportPaths(result: Awaited<ReturnType<typeof attachWorkspacePaths>>) {
    if (result.isMissingWorkspace) {
      toast.error('先在左栏添加一个工作区')
      return
    }
    if (result.attached > 0) toast.success(`已引用 ${result.attached} 项`)
    if (result.skipped.length > 0) {
      toast.warning(`${result.skipped.join('、')} 不在当前工作区内，已跳过`)
    }
  }

  function handlePickImages() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = IMAGE_ACCEPT
    input.multiple = true
    input.onchange = function () {
      const files = Array.from(input.files ?? []).filter(isImageFile)
      void Promise.all(
        files.map(function (file) {
          return attachImage(aui, file)
        })
      ).catch(function (error: unknown) {
        toast.error(error instanceof Error ? error.message : '添加图片失败')
      })
    }
    input.click()
  }

  function handlePickFiles() {
    void dialogOpen({ multiple: true })
      .then(function (paths) {
        const list = Array.isArray(paths) ? paths : paths ? [paths] : null
        return attachWorkspacePaths(aui, list, primaryPath)
      })
      .then(reportPaths)
      .catch(function (error: unknown) {
        toast.error(error instanceof Error ? error.message : '选择文件失败')
      })
  }

  function handlePickFolders() {
    void dialogOpen({ directory: true, multiple: true })
      .then(function (paths) {
        const list = Array.isArray(paths) ? paths : paths ? [paths] : null
        return attachWorkspacePaths(aui, list, primaryPath)
      })
      .then(reportPaths)
      .catch(function (error: unknown) {
        toast.error(error instanceof Error ? error.message : '选择文件夹失败')
      })
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="添加附件"
                  className="text-muted-foreground hover:text-foreground size-7 rounded-md"
                />
              }>
              <Icon icon="lucide:paperclip" />
            </DropdownMenuTrigger>
          }
        />
        <TooltipContent side="top">添加图片、文件或文件夹</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        className="w-44">
        <DropdownMenuItem onClick={handlePickImages}>
          <Icon icon="lucide:image" />
          添加图片
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handlePickFiles}>
          <Icon icon="lucide:file" />
          添加文件
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handlePickFolders}>
          <Icon icon="lucide:folder" />
          添加文件夹
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ComposerClip }
