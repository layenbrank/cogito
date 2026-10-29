import { useMemo } from "react"
import type { Editor, Range } from "@tiptap/react"
import type { EmojiItem } from "@tiptap/extension-emoji"

// --- Tiptap UI ---
import type {
  SuggestionItem,
  SuggestionMenuProps,
  SuggestionMenuRenderProps,
} from "@/components/tiptap-ui-utils/suggestion-menu/suggestion-menu-types.ts"
import { SuggestionMenu } from "@/components/tiptap-ui-utils/suggestion-menu/suggestion-menu.tsx"
import {
  EmojiMenuItem,
} from "@/components/tiptap-ui/emoji-menu/emoji-menu.tsx"
import {
  findFilteredEmojis,
} from "@/components/tiptap-ui/emoji-menu/emoji-menu-utils.ts"
import { Card, CardBody } from "@/components/tiptap-ui-primitive/card/card.tsx"
import { ButtonGroup } from "@/components/tiptap-ui-primitive/button/button.tsx"

export type EmojiDropdownMenuProps = Omit<
  SuggestionMenuProps,
  "items" | "children"
>

export const EmojiDropdownMenu = (props: EmojiDropdownMenuProps) => {
  return (
    <SuggestionMenu
      char=":"
      pluginKey="emojiDropdownMenu"
      decorationClass="tiptap-emoji-decoration"
      selector="tiptap-emoji-dropdown-menu"
      items={findSuggestionItems}
      {...props}
    >
      {(props) => <EmojiList {...props} />}
    </SuggestionMenu>
  )
}

const findSuggestionItems = async (props: { query: string; editor: Editor }) => {
  const emojis: EmojiItem[] = props.editor.extensionStorage.emoji.emojis || []
  const filteredEmojis = findFilteredEmojis({ query: props.query, emojis })

  return filteredEmojis.map(
    (emoji): SuggestionItem => ({
      title: emoji.name,
      subtext: emoji.shortcodes.join(", "),
      context: emoji,
      onSelect: (props: {
        editor: Editor
        range: Range
        context?: EmojiItem
      }) => {
        if (!props.editor || !props.range || !props.context) return
        props.editor.chain().focus().setEmoji(props.context.name).run()
      },
    })
  )
}

const EmojiList = ({
  items,
  selectedIndex,
  onSelect,
}: SuggestionMenuRenderProps<EmojiItem>) => {
  const renderedItems = useMemo(() => {
    const rendered: React.ReactElement[] = []

    items.forEach((item, index) => {
      if (!item.context) return

      rendered.push(
        <EmojiMenuItem
          key={item.title}
          emoji={item.context}
          index={index}
          isSelected={index === selectedIndex}
          onSelect={() => onSelect(item)}
          selector="[data-selector='tiptap-emoji-dropdown-menu']"
        />
      )
    })

    return rendered
  }, [items, selectedIndex, onSelect])

  if (!renderedItems.length) {
    return null
  }

  return (
    <Card
      surface
      style={{
        maxHeight: "var(--suggestion-menu-max-height)",
      }}
    >
      <CardBody>
        <ButtonGroup>{renderedItems}</ButtonGroup>
      </CardBody>
    </Card>
  )
}
