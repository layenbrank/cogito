import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'

import { ContextMenu } from '@/components/contextmenu'
import { useKnowledgeStore } from '@/stores/knowledge'
import { t } from '@/views/knowledge/locale.ts'
import { FileTreeItem } from '@/views/workspace/overlay/file-tree-item.tsx'
import { ROOT_KEY } from '@/views/knowledge/workspace/overlay/use-navigation-tree.ts'
import type { useNavigationTree } from '@/views/knowledge/workspace/overlay/use-navigation-tree.ts'
import type { useNavigationMutations } from '@/views/knowledge/workspace/overlay/use-navigation-mutations.tsx'

type NavigationTree = ReturnType<typeof useNavigationTree>
type NavigationMutations = ReturnType<typeof useNavigationMutations>

interface NavigationPanelProps {
  tree: NavigationTree
  mutations: NavigationMutations
}

function NavigationPanel(props: NavigationPanelProps) {
  const tree = props.tree
  const fileQuery = useKnowledgeStore(function (state) {
    return state.fileQuery
  })
  const toSetFileQuery = useKnowledgeStore(function (state) {
    return state.toSetFileQuery
  })

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border/50 bg-background/65 backdrop-blur-md">
      <div className="flex items-center gap-1 border-b border-border/50 px-1.5 py-1">
        <div className="relative min-w-0 flex-1">
          <Icon
            icon="lucide:search"
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={fileQuery}
            placeholder={t('SEARCH')}
            className="h-7 rounded-md border-border/70 bg-muted/30 pl-7 text-xs"
            onChange={function (event) {
              toSetFileQuery(event.target.value)
            }}
          />
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 shrink-0 rounded-md"
                aria-label={t('NEW_FILE')}
                onClick={function () {
                  void props.mutations.onCreateAtRoot()
                }}
              />
            }>
            <Icon
              icon="lucide:file-plus-2"
              className="size-3.5"
            />
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('NEW_FILE')}</TooltipContent>
        </Tooltip>
      </div>
      <ContextMenu
        trigger="[data-tree-key]"
        findItems={props.mutations.findTreeMenuItems}>
        <ul
          data-tree-key={ROOT_KEY}
          data-tree-kind="directory"
          className={cn('min-h-0 flex-1 list-none overflow-x-hidden overflow-y-auto p-1 text-sm')}>
          {tree.nodes.map(function (node) {
            return (
              <FileTreeItem
                key={node.key}
                node={node}
                activeKey={tree.activeKey}
                expandedKeys={tree.expandedKeys}
                emptyHint={t('TREE_EMPTY')}
                onFetch={tree.fetchChildren}
                onSelect={tree.onSelect}
                onExpandChange={tree.onExpandChange}
              />
            )
          })}
        </ul>
      </ContextMenu>
    </div>
  )
}

export { NavigationPanel }
