/**
 * Command Omnibar 壳：输入 / 引擎轨 / 结果表面
 *
 * 搜索本身在 `useCommandSearch`（浮层灵动岛共用），这里只负责「操作栏里的胶囊」外观。
 */
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Icon } from '@iconify/react/offline'
import { useClickOutside } from '@reactuses/core'
import { cn } from 'cn'
import { useState } from 'react'

import { EngineRail } from '@/features/command-bar/engine-rail'
import { useCommandBarHotkey } from '@/features/command-bar/hotkey'
import { ResultsSurface } from '@/features/command-bar/results'
import { useCommandSearch } from '@/features/command-bar/use-command-search.ts'

function CommandOmnibar() {
  useCommandBarHotkey()
  const [isRailOpen, setRailOpen] = useState(false)
  const search = useCommandSearch({
    isGlobalFocusTarget: true,
    onEscape: function () {
      if (!isRailOpen) return false
      setRailOpen(false)
      return true
    }
  })

  useClickOutside(search.rootRef, function () {
    setRailOpen(false)
    search.close()
  })

  return (
    <div
      ref={search.rootRef}
      className={cn(
        // 宽度上限放在容器上（而不是胶囊上），结果浮层才能和胶囊等宽对齐；
        // 28rem 是为了避开 36rem×36 那种过长的胶囊比例
        'relative mx-auto flex w-full max-w-[28rem] min-w-0 flex-col',
        search.isOpen && 'z-30'
      )}>
      <div
        className={cn(
          'flex h-10 w-full items-center gap-1 px-1.5 transition-[border-radius,background-color]',
          // 展开时胶囊变成卡片的头：只圆上面两个角，结果面板紧接在下面（不留缝、不做独立卡片）
          search.isOpen
            ? 'border-border/60 bg-muted/70 rounded-t-[22px] rounded-b-none border border-b-0'
            : 'bg-muted/60 rounded-full'
        )}>
        <EngineRail
          engineKey={search.engineKey}
          isExpanded={isRailOpen}
          isShellOpen={search.isOpen}
          onExpand={setRailOpen}
          onChoose={function (key) {
            void search.chooseEngine(key)
          }}
        />
        <Input
          ref={search.inputRef}
          value={search.keyword}
          onChange={function (event) {
            setRailOpen(false)
            search.changeKeyword(event.target.value)
          }}
          onKeyDown={search.onKeyDown}
          onFocus={function () {
            search.openSurface()
          }}
          placeholder="搜索磁贴、日程、备忘录或网址…"
          aria-label="命令搜索"
          aria-autocomplete="list"
          aria-expanded={search.isOpen}
          className="h-9 min-w-0 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="搜索"
          className="text-muted-foreground hover:bg-background/70 hover:text-foreground size-8 shrink-0 rounded-full"
          onMouseDown={function (event) {
            // 避免按钮抢焦点导致 isOpen 在 click 前因失焦抖动；提交仍用当前高亮
            event.preventDefault()
          }}
          onClick={function () {
            void search.submit()
          }}>
          <Icon
            icon="lucide:search"
            aria-hidden
            className="size-4"
          />
        </Button>
      </div>

      <ResultsSurface
        hits={search.hits}
        navigation={search.navigation}
        filter={search.filter}
        isOpen={search.isOpen}
        onFilter={search.changeFilter}
        onNavigate={search.setNavigation}
        onSelect={function (hit) {
          void search.activateHit(hit)
        }}
      />    </div>
  )
}

export { CommandOmnibar }
