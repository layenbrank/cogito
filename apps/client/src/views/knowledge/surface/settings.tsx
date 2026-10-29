/**
 * 左面板 · 设置页：库级选项 + 编辑器偏好 + 目录信息。
 *
 * 原来分散在「库设置」对话框与「偏好」Sheet 里的东西合并成一页，改完即生效（无保存按钮）。
 */
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import { Switch } from '@cogito/design/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'

import type { BasePatch } from '@/lib/knowledge-ipc'
import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useKnowledgeStore } from '@/stores/knowledge'

type BaseFlag = 'autoUpdate' | 'autoExport' | 'citation'

/** 库级选项：说明走 tooltip，避免窄栏堆说明文字 */
const BASE_FLAGS: readonly { key: BaseFlag; label: string; hint: string }[] = [
  { key: 'autoUpdate', label: '自动更新', hint: '打开面板时把磁盘上的改动更新进来' },
  { key: 'autoExport', label: '自动导出', hint: '发布后另存一份 HTML 到库目录的 exports/' },
  { key: 'citation', label: '生成带引用', hint: '生成文档时标注引用了哪几篇' }
]

/** 单个开关 → 只带这一项的 patch（后端按「未给的保持不变」处理） */
const FLAG_PATCH: Record<BaseFlag, (value: boolean) => BasePatch> = {
  autoUpdate: function (value) {
    return { autoUpdate: value }
  },
  autoExport: function (value) {
    return { autoExport: value }
  },
  citation: function (value) {
    return { citation: value }
  }
}

function FlagLabel(props: { label: string; hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Label className="text-foreground cursor-help text-xs underline decoration-dotted decoration-muted-foreground/50 underline-offset-2" />
        }>
        {props.label}
      </TooltipTrigger>
      <TooltipContent
        side="right"
        className="max-w-52 text-xs">
        {props.hint}
      </TooltipContent>
    </Tooltip>
  )
}

function SettingsTab() {
  const bases = useKnowledgeBaseStore(function (state) {
    return state.bases
  })
  const activeBaseID = useKnowledgeBaseStore(function (state) {
    return state.activeBaseID
  })
  const updateBase = useKnowledgeBaseStore(function (state) {
    return state.updateBase
  })

  const fontSize = useKnowledgeStore(function (state) {
    return state.fontSize
  })
  const contentMaxWidth = useKnowledgeStore(function (state) {
    return state.contentMaxWidth
  })
  const autosaveMs = useKnowledgeStore(function (state) {
    return state.autosaveMs
  })
  const isTypographyEnabled = useKnowledgeStore(function (state) {
    return state.isTypographyEnabled
  })
  const isTypewriter = useKnowledgeStore(function (state) {
    return state.isTypewriter
  })
  const rootDir = useKnowledgeStore(function (state) {
    return state.rootDir
  })
  const toPatchPreferences = useKnowledgeStore(function (state) {
    return state.toPatchPreferences
  })

  const activeBase = bases.find(function (base) {
    return base.id === activeBaseID
  })

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-4 pb-4">
        <section className="flex flex-col gap-1.5">
          <p className="text-muted-foreground px-0.5 text-xs font-medium">库选项</p>
          {BASE_FLAGS.map(function (flag) {
            const value = activeBase ? activeBase[flag.key] : false
            return (
              <div
                key={flag.key}
                className="flex items-center justify-between gap-2 px-0.5">
                <FlagLabel
                  label={flag.label}
                  hint={flag.hint}
                />
                <Switch
                  checked={value}
                  disabled={!activeBase}
                  onCheckedChange={function (checked) {
                    void updateBase(FLAG_PATCH[flag.key](checked))
                  }}
                />
              </div>
            )
          })}
        </section>

        <section className="flex flex-col gap-1.5">
          <p className="text-muted-foreground px-0.5 text-xs font-medium">编辑器</p>
          <div className="flex items-center justify-between gap-2 px-0.5">
            <Label
              htmlFor="panel-font"
              className="text-xs">
              字号
            </Label>
            <Input
              id="panel-font"
              type="number"
              min={12}
              max={28}
              value={fontSize}
              className="h-7 w-20 text-xs"
              onChange={function (event) {
                toPatchPreferences({ fontSize: Number(event.target.value) || 16 })
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-0.5">
            <Label
              htmlFor="panel-width"
              className="text-xs">
              内容宽度
            </Label>
            <Input
              id="panel-width"
              type="number"
              min={480}
              max={1200}
              value={contentMaxWidth}
              className="h-7 w-20 text-xs"
              onChange={function (event) {
                toPatchPreferences({
                  contentMaxWidth: Number(event.target.value) || 760
                })
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-0.5">
            <Label
              htmlFor="panel-autosave"
              className="text-xs">
              自动保存 (ms)
            </Label>
            <Input
              id="panel-autosave"
              type="number"
              min={0}
              step={500}
              value={autosaveMs}
              className="h-7 w-20 text-xs"
              onChange={function (event) {
                toPatchPreferences({
                  autosaveMs: Math.max(0, Number(event.target.value) || 0)
                })
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-0.5">
            <Label
              htmlFor="panel-typo"
              className="text-xs">
              智能标点
            </Label>
            <Switch
              id="panel-typo"
              checked={isTypographyEnabled}
              onCheckedChange={function (checked) {
                toPatchPreferences({ isTypographyEnabled: checked })
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-0.5">
            <Label
              htmlFor="panel-typewriter"
              className="text-xs">
              打字机滚动
            </Label>
            <Switch
              id="panel-typewriter"
              checked={isTypewriter}
              onCheckedChange={function (checked) {
                toPatchPreferences({ isTypewriter: checked })
              }}
            />
          </div>
        </section>

        <section className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1 px-0.5">
            <p className="text-muted-foreground text-xs font-medium">位置</p>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground size-4 rounded-sm text-xs leading-none"
                    aria-label="路径说明"
                  />
                }>
                ?
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className="max-w-56 text-xs">
                正文以磁盘文件为准；草稿在库目录旁的 .staging，导出在 exports。
              </TooltipContent>
            </Tooltip>
          </div>
          {activeBase ? (
            <p
              className="text-muted-foreground break-all px-0.5 text-xs"
              title={activeBase.rootPath}>
              库：{activeBase.rootPath}
            </p>
          ) : null}
          <p
            className="text-muted-foreground break-all px-0.5 text-xs"
            title={rootDir ?? undefined}>
            侧栏：{rootDir ?? '—'}
          </p>
        </section>
      </div>
    </ScrollArea>
  )
}

export { SettingsTab }
