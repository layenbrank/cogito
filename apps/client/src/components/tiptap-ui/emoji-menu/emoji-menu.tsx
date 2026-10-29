'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { EmojiItem } from '@tiptap/extension-emoji'

// --- Hooks ---
import { useMenuNavigation } from '@/hooks/use-menu-navigation.ts'

// --- Lib ---
import { findElementOverflowPosition } from '@/lib/tiptap-collab-utils.ts'

// --- UI Primitives ---
import {
  Button,
  ButtonGroup
} from '@/components/tiptap-ui-primitive/button/button.tsx'
import { Input } from '@/components/tiptap-ui-primitive/input/input.tsx'
import {
  Card,
  CardBody,
  CardHeader
} from '@/components/tiptap-ui-primitive/card/card.tsx'

import { findFilteredEmojis } from '@/components/tiptap-ui/emoji-menu/emoji-menu-utils.ts'

// --- Styles ---
import '@/components/tiptap-ui/emoji-menu/emoji-menu.scss'

export interface EmojiMenuItemProps<T extends EmojiItem> {
  emoji: T
  index: number
  isSelected: boolean
  onSelect: (emoji: T) => void
  selector: string
}

export const EmojiMenuItem = <T extends EmojiItem>(
  props: EmojiMenuItemProps<T>
) => {
  const { emoji, isSelected, onSelect, selector } = props
  const itemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const menuElement = document.querySelector(selector) as HTMLElement
    if (!itemRef.current || !isSelected || !menuElement) return

    const overflow = findElementOverflowPosition(itemRef.current, menuElement)
    if (overflow === 'top') {
      itemRef.current.scrollIntoView(true)
    } else if (overflow === 'bottom') {
      itemRef.current.scrollIntoView(false)
    }
  }, [isSelected, selector])

  if (!emoji) return null

  return (
    <Button
      ref={itemRef}
      data-style="ghost"
      data-active-state={isSelected ? 'on' : 'off'}
      onClick={() => onSelect(emoji)}>
      {emoji.fallbackImage ? (
        <img
          className="tiptap-button-emoji"
          src={emoji.fallbackImage}
          alt={emoji.name}
        />
      ) : (
        <span className="tiptap-button-emoji">{emoji.emoji}</span>
      )}
      <span className="truncate text-xs">:{emoji.name}:</span>
    </Button>
  )
}

export interface EmojiMenuProps<T extends EmojiItem> {
  emojis: T[]
  onSelect: (emoji: T) => void
  onClose?: () => void
  showSearch?: boolean
  selector?: string
}

export const EmojiMenu = <T extends EmojiItem>(props: EmojiMenuProps<T>) => {
  const {
    emojis,
    onSelect,
    onClose,
    showSearch = false,
    selector = '.emoji-menu-list'
  } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const [searchQuery, setSearchQuery] = useState<string>('')

  const filteredEmojis = useMemo(() => {
    const filtered = findFilteredEmojis({ query: searchQuery, emojis })
    return filtered
  }, [emojis, searchQuery])

  const { selectedIndex } = useMenuNavigation({
    containerRef,
    query: searchQuery,
    items: filteredEmojis,
    onSelect,
    onClose
  })

  const renderedItems = useMemo(() => {
    return filteredEmojis.map((emoji, index) => (
      <EmojiMenuItem
        key={emoji.name}
        emoji={emoji}
        index={index}
        isSelected={index === selectedIndex}
        onSelect={() => onSelect(emoji)}
        selector={selector}
      />
    ))
  }, [filteredEmojis, selectedIndex, onSelect, selector])

  return (
    <Card
      surface
      ref={containerRef}>
      {showSearch && (
        <CardHeader>
          <Input
            ref={searchRef}
            type="text"
            placeholder={t('EDITOR_EMOJI_SEARCH')}
            value={searchQuery}
            autoFocus
            onChange={(e) => setSearchQuery(e.target.value)}
            className="emoji-menu-search-input"
          />
        </CardHeader>
      )}

      {renderedItems.length > 0 ? (
        <CardBody className="emoji-menu-list">
          <ButtonGroup>{renderedItems}</ButtonGroup>
        </CardBody>
      ) : null}
    </Card>
  )
}

import { t } from '@/views/knowledge/locale.ts'