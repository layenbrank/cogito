/**
 * 左面板 · 待发布页：agent 写的草稿在这里合并/发布/丢弃。
 *
 * 全部就地完成：
 * - 合并 = 分组行里改个标题点一下（不弹框）；
 * - 发布「覆盖同名」= 两段式（第一下变「确认覆盖」，第二下才执行）；
 * - 「保留两者」= 一次点击，不需要确认（不会丢东西）。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import { useState } from 'react'
import { toast } from 'sonner'

import type { StagedFile } from '@/lib/knowledge-ipc'
import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { formatSize, formatTime } from '@/views/knowledge/lib/format.ts'

interface StagingGroup {
  session: string
  files: StagedFile[]
}

/** 同一次生成的分章都落在同一个会话目录，按会话分组才能给出「合并」 */
function groupStaging(files: StagedFile[]): StagingGroup[] {
  const buckets = new Map<string, StagedFile[]>()
  for (const file of files) {
    const bucket = buckets.get(file.session)
    if (bucket) bucket.push(file)
    else buckets.set(file.session, [file])
  }
  return [...buckets.entries()].map(function ([session, items]) {
    return {
      session,
      files: [...items].sort(function (left, right) {
        return left.path.localeCompare(right.path)
      })
    }
  })
}

/** 合并标题默认取首章名（去掉序号与扩展名），用户可改 */
function mergeTitleOf(files: StagedFile[]): string {
  const firstName = files[0]?.name ?? ''
  return firstName
    .replace(/\.md$/i, '')
    .replace(/^\d+\s*[-_.、]?\s*/, '')
    .trim()
}

function StagingTab() {
  const staging = useKnowledgeBaseStore(function (state) {
    return state.staging
  })
  const isPublishing = useKnowledgeBaseStore(function (state) {
    return state.isPublishing
  })
  const publish = useKnowledgeBaseStore(function (state) {
    return state.publish
  })
  const discard = useKnowledgeBaseStore(function (state) {
    return state.discard
  })
  const merge = useKnowledgeBaseStore(function (state) {
    return state.merge
  })

  /** 正在改标题的分组（合并前的一步） */
  const [mergeDraft, setMergeDraft] = useState<{ session: string; title: string } | null>(null)
  /** 已点过「覆盖同名」等第二次确认的文件 */
  const [confirmPath, setConfirmPath] = useState<string | null>(null)

  if (staging.length === 0) {
    return (
      <p
        className="text-muted-foreground px-1 py-3 text-xs"
        title="助手写好的文档会先落在这里，确认后才进正式目录">
        暂无待发布
      </p>
    )
  }

  const groups = groupStaging(staging)

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-3">
        {groups.map(function (group) {
          const isMerging = mergeDraft?.session === group.session
          return (
            <div
              key={group.session}
              className="flex flex-col gap-1.5">
              {group.files.length > 1 ? (
                isMerging ? (
                  <div className="flex items-center gap-1">
                    <Input
                      autoFocus
                      value={mergeDraft.title}
                      placeholder="合并后的标题"
                      className="h-7 text-xs"
                      onChange={function (event) {
                        setMergeDraft({ session: group.session, title: event.target.value })
                      }}
                      onKeyDown={function (event) {
                        if (event.key === 'Escape') setMergeDraft(null)
                      }}
                    />
                    <Button
                      size="sm"
                      disabled={!mergeDraft.title.trim() || isPublishing}
                      onClick={function () {
                        const title = mergeDraft.title.trim()
                        void merge(
                          group.files.map(function (file) {
                            return file.path
                          }),
                          title
                        ).then(function (ok) {
                          if (!ok) return
                          setMergeDraft(null)
                          toast.success(`已合并为「${title}」`)
                        })
                      }}>
                      合并
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={function () {
                        setMergeDraft(null)
                      }}>
                      取消
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2 px-0.5 text-[11px] text-muted-foreground">
                    <span className="truncate">同批 {group.files.length} 章</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[11px] font-normal"
                      title="按文件名顺序拼成一篇（仍是草稿）"
                      onClick={function () {
                        setMergeDraft({ session: group.session, title: mergeTitleOf(group.files) })
                      }}>
                      <Icon
                        icon="lucide:combine"
                        className="size-3"
                      />
                      合成一篇
                    </Button>
                  </div>
                )
              ) : null}

              <ul className="flex flex-col gap-1.5">
                {group.files.map(function (file) {
                  return (
                    <li
                      key={file.path}
                      className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
                      <p className="truncate text-xs">{file.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {formatSize(file.size)} · {formatTime(file.modifiedAt)}
                      </p>
                      <div className="mt-1 flex items-center gap-1">
                        <Button
                          size="sm"
                          variant={confirmPath === file.path ? 'destructive' : 'default'}
                          className="h-6 px-2 text-[11px]"
                          disabled={isPublishing}
                          onClick={function () {
                            if (confirmPath !== file.path) {
                              setConfirmPath(file.path)
                              return
                            }
                            setConfirmPath(null)
                            void publish(file, 'replace').then(function (ok) {
                              if (ok) toast.success(`已发布「${file.name}」`)
                            })
                          }}>
                          {confirmPath === file.path ? '确认覆盖' : '发布'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[11px]"
                          disabled={isPublishing}
                          title="同名文件也保留，自动加后缀"
                          onClick={function () {
                            void publish(file, 'keepboth').then(function (ok) {
                              if (ok) toast.success(`已发布「${file.name}」`)
                            })
                          }}>
                          保留两者
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-[11px]"
                          onClick={function () {
                            void discard(file)
                          }}>
                          丢弃
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

export { StagingTab }
