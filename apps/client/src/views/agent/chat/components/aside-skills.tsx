/**
 * 右栏「技能」：按**工作区所有文件夹**识别 SKILL.md（不是只看当前那个文件夹）。
 *
 * 技能是跟着工作区走的：`folderPaths` 里每个文件夹都会被扫一遍，所以在 `api/` 里干活
 * 也能看到 `docs/` 里的技能。引用时路径必须按会话 cwd（主文件夹）折算 ——
 * 非主文件夹里的技能给相对路径，agent 在主文件夹里根本解析不到（`toAgentPath`）。
 */
import type { useAui } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { attachWorkspaceFile } from '@/features/agent/attachment.ts'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { findOwningRoot, toAgentPath } from '@/features/agent/workspace/paths.ts'
import { WorkspaceSkills, type WorkspaceSkill } from '@/lib/workspace-skills.ts'
import { findBaseName } from '@/views/agent/chat/components/workspace-relative-path.ts'

type ComposerAui = ReturnType<typeof useAui>

interface AsideSkillsProps {
  aui: ComposerAui
  className?: string
}

const AsideSkills = function AsideSkills(props: AsideSkillsProps) {
  const { folderPaths, primaryRootPath } = useActiveWorkspace()
  const [skills, updateSkills] = useState<WorkspaceSkill[]>([])
  const [query, updateQuery] = useState('')
  const [isLoading, updateLoading] = useState(false)
  // 数组引用每次渲染都可能变：用拼接串做依赖，避免无谓重扫
  const folderKey = folderPaths.join('\n')

  useEffect(
    function () {
      let cancelled = false
      async function load() {
        try {
          updateLoading(true)
          // 多文件夹口径：整个工作区一起扫，不是只扫当前文件夹
          const rows = await WorkspaceSkills.fetchSkills(folderKey ? folderKey.split('\n') : [])
          if (!cancelled) updateSkills(rows)
        } catch (cause) {
          console.warn('[aside-skills] 读取技能失败', cause)
          if (!cancelled) updateSkills([])
        } finally {
          if (!cancelled) updateLoading(false)
        }
      }
      void load()
      return function () {
        cancelled = true
      }
    },
    [folderKey]
  )

  const needle = query.trim().toLowerCase()
  const visible = needle
    ? skills.filter(function (skill) {
        return (
          skill.name.toLowerCase().includes(needle) ||
          skill.description.toLowerCase().includes(needle)
        )
      })
    : skills

  function pick(skill: WorkspaceSkill) {
    const reference = toAgentPath(skill.path, primaryRootPath)
    void attachWorkspaceFile(props.aui, reference)
      .then(function () {
        toast.success(`已引用技能「${skill.name}」`)
      })
      .catch(function (cause: unknown) {
        toast.error(cause instanceof Error ? cause.message : '引用失败')
      })
  }

  return (
    <div className={clsx('flex min-h-0 flex-1 flex-col', props.className)}>
      <div className="shrink-0 border-b p-2">
        <Input
          value={query}
          placeholder="搜索技能"
          aria-label="搜索技能"
          className="h-7 text-xs"
          onChange={function (event) {
            updateQuery(event.target.value)
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {isLoading && skills.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-1.5 p-2.5 text-xs">
            <Icon
              icon="lucide:loader-circle"
              className="size-3.5 animate-spin"
            />
            读取中…
          </p>
        ) : null}

        {visible.map(function (skill) {
          const owner = findOwningRoot(skill.path, folderPaths)
          return (
            <Button
              key={skill.id}
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-xs font-normal"
              title={skill.path}
              onClick={function () {
                pick(skill)
              }}>
              <Icon
                icon="lucide:wrench"
                className="text-muted-foreground size-3.5 shrink-0"
              />
              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className="w-full truncate text-start">{skill.name}</span>
                <span className="text-muted-foreground w-full truncate text-start text-xs">
                  {skill.description || skill.relative}
                </span>
              </span>
              {/* 多文件夹时标出技能属于哪个文件夹：同名技能一眼能分清 */}
              {folderPaths.length > 1 && owner ? (
                <span className="bg-muted text-muted-foreground shrink-0 rounded px-1 py-0.5 text-[10px] leading-none">
                  {findBaseName(owner)}
                </span>
              ) : null}
            </Button>
          )
        })}

        {!isLoading && visible.length === 0 ? (
          <p className="text-muted-foreground p-2.5 text-xs">
            {folderPaths.length === 0
              ? '先在左栏添加一个工作区'
              : needle
                ? '没有匹配的技能'
                : '当前工作区暂无技能（在任意文件夹里放 SKILL.md 即可）'}
          </p>
        ) : null}
      </div>

      <div className="border-border/60 flex shrink-0 items-center justify-between gap-2 border-t px-2.5 py-1.5">
        <span className="text-muted-foreground truncate text-xs">
          按工作区 {folderPaths.length} 个文件夹识别 · {visible.length} 个技能
        </span>
        <span className="text-muted-foreground shrink-0 text-xs">点一下引用</span>
      </div>
    </div>
  )
}

export { AsideSkills }
