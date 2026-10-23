import { Icon } from '@iconify/react/offline'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Input } from '@cogito/design/components/input'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { useWorkspaces, type Workspace } from '@/features/agent/workspace/client.ts'
import {
  WORKSPACE_COLOR,
  WORKSPACE_COLORS,
  WORKSPACE_ICON,
  WORKSPACE_ICONS
} from '@/shared/workspace-icons.ts'
import { toIpcMessage } from '@/utils/ipc.errors.ts'

interface WorkspaceFormProps {
  open: boolean
  workspaceID?: string | null
  onOpenChange: (open: boolean) => void
}

interface FolderDraft {
  id: string
  path: string
  isPrimary: boolean
}

const ICON_MAP: Record<string, string> = {
  folder: 'lucide:folder',
  code: 'lucide:code',
  layout: 'lucide:layout-grid',
  cloud: 'lucide:cloud',
  atom: 'lucide:lightbulb',
  setting: 'lucide:settings',
  database: 'lucide:database',
  bulb: 'lucide:lightbulb',
  rocket: 'lucide:rocket',
  book: 'lucide:book',
  api: 'lucide:wrench',
  tool: 'lucide:wrench',
  global: 'lucide:globe',
  desktop: 'lucide:monitor',
  coffee: 'lucide:coffee'
}

function basename(folderPath: string): string {
  const normalized = folderPath.replace(/[/\\]+$/, '')
  const parts = normalized.split(/[/\\]/)
  return parts[parts.length - 1] || folderPath
}

function WorkspaceForm(props: WorkspaceFormProps) {
  const client = useQueryClient()
  const workspaces = useWorkspaces()
  const editing: Workspace | null =
    props.workspaceID === null || props.workspaceID === undefined
      ? null
      : (workspaces.data?.find(function (item) {
          return item.id === props.workspaceID
        }) ?? null)
  const isEdit = Boolean(editing)

  const [title, updateTitle] = useState('')
  const [icon, updateIcon] = useState(WORKSPACE_ICON)
  const [color, updateColor] = useState(WORKSPACE_COLOR)
  const [folders, updateFolders] = useState<FolderDraft[]>([])
  const [saving, updateSaving] = useState(false)

  /**
   * 打开时用目标工作区重置草稿。
   *
   * 在渲染期调整（React 官方对「prop 变了要重置 state」的首选是 key，其次就是这个），
   * 而不是放进 effect：effect 里 setState 会多一整轮提交，且每轮 refetch 生成新对象
   * 都会把用户正在输入的内容冲掉。
   */
  const seedKey = props.open ? (editing?.id ?? 'new') : null
  const [seededKey, updateSeededKey] = useState<string | null>(null)
  if (seedKey === null) {
    // 关闭时只复位「播种标记」，下次打开重新取数；不动草稿，否则关闭动画里字段会先空掉
    if (seededKey !== null) updateSeededKey(null)
  } else if (seedKey !== seededKey) {
    updateSeededKey(seedKey)
    updateTitle(editing?.title ?? '')
    updateIcon(editing?.icon || WORKSPACE_ICON)
    updateColor(editing?.color || WORKSPACE_COLOR)
    updateFolders(
      (editing?.folders ?? []).map(function (folder) {
        return {
          id: folder.id,
          path: folder.path,
          isPrimary: folder.isPrimary
        }
      })
    )
  }

  async function handleAddFolder() {
    const picked = await itc.dialog.open({ directory: true })
    if (!picked || picked.length === 0) return
    const path = picked[0]
    updateFolders(function (prev) {
      if (
        prev.some(function (item) {
          return item.path === path
        })
      ) {
        return prev
      }
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          path,
          isPrimary: prev.length === 0
        }
      ]
    })
  }

  function handleRemoveFolder(id: string) {
    updateFolders(function (prev) {
      const next = prev.filter(function (item) {
        return item.id !== id
      })
      if (
        next.length > 0 &&
        !next.some(function (item) {
          return item.isPrimary
        })
      ) {
        next[0].isPrimary = true
      }
      return next
    })
  }

  function handlePrimaryFolder(id: string) {
    updateFolders(function (prev) {
      return prev.map(function (item) {
        return { ...item, isPrimary: item.id === id }
      })
    })
  }

  async function handleArchive() {
    if (!props.workspaceID) return
    updateSaving(true)
    try {
      await itc.workspace.toArchive({ id: props.workspaceID })
      await client.invalidateQueries({ queryKey: ['workspace', 'list'] })
      toast.success('已归档工作区')
      props.onOpenChange(false)
    } catch (error) {
      toast.error(toIpcMessage(error, '归档失败'))
    } finally {
      updateSaving(false)
    }
  }

  async function handleSave() {
    const trimmed = title.trim()
    if (!trimmed) {
      toast.warning('请输入工作区名称')
      return
    }
    if (folders.length === 0) {
      toast.warning('请至少添加一个源文件夹')
      return
    }

    updateSaving(true)
    try {
      if (isEdit && props.workspaceID) {
        await itc.workspace.toUpdate({
          id: props.workspaceID,
          title: trimmed,
          icon,
          color,
          folders: folders.map(function (folder) {
            return {
              id: folder.id,
              path: folder.path,
              isPrimary: folder.isPrimary
            }
          })
        })
        toast.success('已保存工作区')
      } else {
        await itc.workspace.toWrite({
          title: trimmed,
          icon,
          color,
          folders: folders.map(function (folder) {
            return { path: folder.path, isPrimary: folder.isPrimary }
          })
        })
        toast.success('已创建工作区')
      }
      await client.invalidateQueries({ queryKey: ['workspace', 'list'] })
      props.onOpenChange(false)
    } catch (error) {
      toast.error(toIpcMessage(error, isEdit ? '保存失败' : '创建失败'))
    } finally {
      updateSaving(false)
    }
  }

  const previewIcon = ICON_MAP[icon] ?? 'lucide:folder'

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑工作区' : '新建工作区'}</DialogTitle>
          <DialogDescription className="sr-only">
            配置源文件夹、名称、图标与颜色
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">源文件夹</span>
              {folders.length > 0 ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  onClick={function () {
                    void handleAddFolder()
                  }}>
                  <Icon icon="lucide:plus" />
                  添加
                </Button>
              ) : null}
            </div>

            {folders.length === 0 ? (
              <button
                type="button"
                className="border-border hover:bg-muted/40 flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-sm"
                onClick={function () {
                  void handleAddFolder()
                }}>
                <Icon icon="lucide:folder-plus" className="text-muted-foreground size-7" />
                <span className="text-muted-foreground">点击添加可读写文件夹</span>
              </button>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {folders.map(function (folder) {
                  return (
                    <li
                      key={folder.id}
                      className="border-border flex items-center gap-2 rounded-md border px-2 py-1.5">
                      <Icon icon="lucide:folder" className="text-muted-foreground size-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{basename(folder.path)}</p>
                        <p className="text-muted-foreground truncate text-xs">{folder.path}</p>
                      </div>
                      {folder.isPrimary ? (
                        <Badge variant="secondary">主要</Badge>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={function () {
                            handlePrimaryFolder(folder.id)
                          }}>
                          设为主要
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="移除文件夹"
                        onClick={function () {
                          handleRemoveFolder(folder.id)
                        }}>
                        <Icon icon="lucide:x" />
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-sm font-medium"
              htmlFor="workspace-title">
              工作区名称
            </label>
            <Input
              id="workspace-title"
              value={title}
              placeholder="例如 my-project"
              onChange={function (event) {
                updateTitle(event.target.value)
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">工作区图标</span>
            <div className="flex flex-wrap gap-1.5">
              {WORKSPACE_ICONS.map(function (item) {
                const glyph = ICON_MAP[item.key] ?? 'lucide:folder'
                const isActive = icon === item.key
                return (
                  <button
                    key={item.key}
                    type="button"
                    title={item.label}
                    aria-label={item.label}
                    data-active={isActive ? 'true' : 'false'}
                    className="hover:bg-muted data-[active=true]:bg-muted data-[active=true]:ring-border flex size-9 items-center justify-center rounded-md data-[active=true]:ring-1"
                    onClick={function () {
                      updateIcon(item.key)
                    }}>
                    <Icon
                      icon={glyph}
                      className="size-4"
                    />
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">工作区颜色</span>
            <div className="flex flex-wrap gap-2">
              {WORKSPACE_COLORS.map(function (swatch) {
                const isActive = color === swatch
                return (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`颜色 ${swatch}`}
                    data-active={isActive ? 'true' : 'false'}
                    className="size-6 rounded-full data-[active=true]:ring-2 data-[active=true]:ring-offset-2"
                    style={{ backgroundColor: swatch }}
                    onClick={function () {
                      updateColor(swatch)
                    }}
                  />
                )
              })}
            </div>
          </div>

          <div className="border-border flex items-center gap-2 rounded-md border px-3 py-2">
            <span
              className="flex size-8 items-center justify-center rounded-md text-white"
              style={{ backgroundColor: color }}>
              <Icon
                icon={previewIcon}
                className="size-4"
              />
            </span>
            <span className="truncate text-sm font-medium">{title.trim() || '工作区预览'}</span>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {isEdit ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={saving}
              onClick={function () {
                void handleArchive()
              }}>
              <Icon icon="lucide:archive" />
              归档工作区
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={function () {
                props.onOpenChange(false)
              }}>
              取消
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={function () {
                void handleSave()
              }}>
              {isEdit ? '保存' : '创建'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ICON_MAP, WorkspaceForm }
export type { WorkspaceFormProps }
