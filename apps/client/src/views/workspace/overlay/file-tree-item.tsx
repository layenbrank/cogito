import { Icon } from '@iconify/react/offline'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@i-thinking/design/components/collapsible'

export interface FileTreeNode {
  title: string
  key: string
  isLeaf?: boolean
  children?: FileTreeNode[]
}

interface FileTreeItemProps {
  node: FileTreeNode
  onLoad: (node: FileTreeNode) => Promise<void>
  onSelect: (node: FileTreeNode) => void
}

function FileTreeItem(props: FileTreeItemProps) {
  const node = props.node

  if (node.isLeaf) {
    return (
      <li>
        <button
          type="button"
          onClick={function () {
            props.onSelect(node)
          }}
          className="w-full truncate rounded-sm px-1 py-0.5 text-left hover:bg-muted">
          {node.title}
        </button>
      </li>
    )
  }

  return (
    <li>
      <Collapsible
        className="group/node"
        onOpenChange={function (isOpen) {
          if (isOpen) void props.onLoad(node)
        }}>
        <CollapsibleTrigger className="flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-left hover:bg-muted">
          <Icon
            icon="lucide:chevron-right"
            className="size-3.5 shrink-0 transition-transform group-data-[panel-open]/node:rotate-90"
          />
          <span className="truncate">{node.title}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="pl-4">
            {node.children?.map(function (child) {
              return (
                <FileTreeItem
                  key={child.key}
                  node={child}
                  onLoad={props.onLoad}
                  onSelect={props.onSelect}
                />
              )
            })}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

export { FileTreeItem }
