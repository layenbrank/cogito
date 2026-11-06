/**
 * composer 左下角的「知识库」：列库 → 列文档 → 点一下把文档引用进本轮对话。
 *
 * 取代原来的 `+` 面板（`+` 里的工作区 / 技能在右栏都有对应页签，只有 MCP 插件列表没有，
 * 已一并搬到右栏「扩展」页签）。这里只留一件右栏没有的动作：**在当前输入的位置引用知识库文档**。
 */
import { Icon } from '@iconify/react/offline'
import { useAui } from '@assistant-ui/react'
import { Button } from '@cogito/design/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@cogito/design/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { useState } from 'react'

import { KnowledgeBrowser } from './knowledge-browser.tsx'

function ComposerKnowledge() {
  const aui = useAui()
  const [isOpen, updateOpen] = useState(false)
  const [isTooltipOpen, updateTooltipOpen] = useState(false)

  function handleOpenChange(next: boolean) {
    updateOpen(next)
    if (next) updateTooltipOpen(false)
  }

  return (
    <Popover
      open={isOpen}
      onOpenChange={handleOpenChange}>
      <Tooltip
        open={isOpen ? false : isTooltipOpen}
        onOpenChange={function (next) {
          if (!isOpen) updateTooltipOpen(next)
        }}>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="知识库"
                  className="text-muted-foreground hover:text-foreground size-7 rounded-md"
                />
              }>
              <Icon icon="lucide:library" />
            </PopoverTrigger>
          }
        />
        <TooltipContent
          side="top"
          className="max-w-56 text-start">
          <span className="block">知识库</span>
          <span className="text-background/75 block">引用知识库文档到本轮对话</span>
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        align="start"
        className="w-[min(24rem,calc(100vw-2.5rem))] overflow-hidden rounded-xl border-0 p-0 shadow-[0_10px_36px_-8px_color-mix(in_oklab,var(--foreground)_18%,transparent),0_4px_14px_-4px_color-mix(in_oklab,var(--foreground)_10%,transparent)]">
        <div className="flex h-80 min-h-0 w-full">
          <KnowledgeBrowser
            aui={aui}
            active={isOpen}
            onPicked={function () {
              updateOpen(false)
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { ComposerKnowledge }
