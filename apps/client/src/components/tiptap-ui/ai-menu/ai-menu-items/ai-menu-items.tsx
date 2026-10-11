// @ts-nocheck
import { Fragment, useCallback, useMemo } from 'react'
import { type Editor } from '@tiptap/react'
import type { TextOptions } from '@tiptap-pro/extension-ai'
import { type Language } from '@tiptap-pro/extension-ai'

// -- Hooks --
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'

// -- Tiptap UI --
import { getContextAndInsertAt } from '@/components/tiptap-ui/ai-menu/ai-menu-utils.ts'
import { useAiMenuState } from '@/components/tiptap-ui/ai-menu/ai-menu-hooks.ts'

// -- UI Primitives --
import {
  Menu,
  MenuButton,
  MenuButtonArrow,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem
} from '@/components/tiptap-ui-primitive/menu/menu.tsx'
import { type Action } from '@/components/tiptap-ui-primitive/menu/menu-types.ts'
import {
  filterMenuGroups,
  filterMenuItems
} from '@/components/tiptap-ui-primitive/menu/menu-utils.ts'
import { useComboboxValueState } from '@/components/tiptap-ui-primitive/menu/menu-hooks.ts'
import { Button } from '@/components/tiptap-ui-primitive/button/button.tsx'
import { ComboboxList } from '@/components/tiptap-ui-primitive/combobox/combobox.tsx'
import { Separator } from '@/components/tiptap-ui-primitive/separator/separator.tsx'

import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_TONES
} from '@/components/tiptap-ui/ai-menu/ai-menu-items/ai-menu-items-constants.ts'
import type {
  EditorMenuAction,
  ExecutableMenuAction,
  MenuActionIdentifier,
  MenuActionRendererProps,
  NestedMenuAction
} from '@/components/tiptap-ui/ai-menu/ai-menu-items/ai-menu-items-types.ts'

// -- Icons --
import { ChevronRightIcon } from '@/components/tiptap-icons/chevron-right-icon.tsx'
import { SummarizeTextIcon } from '@/components/tiptap-icons/summarize-text-icon.tsx'
import { Simplify2Icon } from '@/components/tiptap-icons/simplify-2-icon.tsx'
import { LanguagesIcon } from '@/components/tiptap-icons/languages-icon.tsx'
import { MicAiIcon } from '@/components/tiptap-icons/mic-ai-icon.tsx'
import { TextExtendIcon } from '@/components/tiptap-icons/text-extend-icon.tsx'
import { TextReduceIcon } from '@/components/tiptap-icons/text-reduce-icon.tsx'
import { CompleteSentenceIcon } from '@/components/tiptap-icons/complete-sentence-icon.tsx'
import { SmileAiIcon } from '@/components/tiptap-icons/smile-ai-icon.tsx'
import { CheckAiIcon } from '@/components/tiptap-icons/check-ai-icon.tsx'

function initializeEditorMenuActions(): Record<
  MenuActionIdentifier,
  EditorMenuAction
> {
  return {
    adjustTone: {
      type: 'nested',
      component: ToneSelectionSubmenu,
      filterItems: true,
      icon: <MicAiIcon className="tiptap-button-icon" />,
      items: SUPPORTED_TONES,
      label: 'Adjust tone',
      value: 'adjustTone'
    },
    aiFixSpellingAndGrammar: {
      type: 'executable',
      icon: <CheckAiIcon className="tiptap-button-icon" />,
      label: 'Fix spelling & grammar',
      value: 'aiFixSpellingAndGrammar',
      onSelect: ({ editor, options }) => {
        if (!editor) return

        const { insertAt, isSelection, context } = getContextAndInsertAt(editor)
        const newOptions: TextOptions = {
          ...options,
          insertAt,
          regenerate: !isSelection
        }

        if (isSelection) {
          newOptions.text = context
        }

        editor.chain().aiFixSpellingAndGrammar(newOptions).run()
      }
    },
    aiExtend: {
      type: 'executable',
      icon: <TextExtendIcon className="tiptap-button-icon" />,
      label: 'Make longer',
      value: 'aiExtend',
      onSelect: ({ editor, options }) => {
        if (!editor) return

        const { insertAt, isSelection, context } = getContextAndInsertAt(editor)
        const newOptions: TextOptions = {
          ...options,
          insertAt,
          regenerate: !isSelection
        }

        if (isSelection) {
          newOptions.text = context
        }

        editor.chain().aiExtend(newOptions).run()
      }
    },
    aiShorten: {
      type: 'executable',
      icon: <TextReduceIcon className="tiptap-button-icon" />,
      label: 'Make shorter',
      value: 'aiShorten',
      onSelect: ({ editor, options }) => {
        if (!editor) return

        const { insertAt, isSelection, context } = getContextAndInsertAt(editor)
        const newOptions: TextOptions = {
          ...options,
          insertAt,
          regenerate: !isSelection
        }

        if (isSelection) {
          newOptions.text = context
        }

        editor.chain().aiShorten(newOptions).run()
      }
    },
    simplifyLanguage: {
      type: 'executable',
      icon: <Simplify2Icon className="tiptap-button-icon" />,
      label: 'Simplify language',
      value: 'simplifyLanguage',
      onSelect: ({ editor, options }) => {
        if (!editor) return

        const { insertAt, isSelection, context } = getContextAndInsertAt(editor)
        const newOptions: TextOptions = {
          ...options,
          insertAt,
          regenerate: !isSelection
        }

        if (isSelection) {
          newOptions.text = context
        }

        editor.chain().aiSimplify(newOptions).run()
      }
    },
    improveWriting: {
      type: 'executable',
      icon: <SmileAiIcon className="tiptap-button-icon" />,
      label: 'Improve writing',
      value: 'improveWriting',
      onSelect: ({ editor, options }) => {
        if (!editor) return

        const { insertAt, isSelection, context } = getContextAndInsertAt(editor)
        const newOptions: TextOptions = {
          ...options,
          insertAt,
          regenerate: !isSelection
        }

        if (isSelection) {
          newOptions.text = context
        }

        editor.chain().aiRephrase(newOptions).run()
      }
    },
    emojify: {
      type: 'executable',
      icon: <SmileAiIcon className="tiptap-button-icon" />,
      label: 'Emojify',
      value: 'emojify',
      onSelect: ({ editor, options }) => {
        if (!editor) return

        const { insertAt, isSelection, context } = getContextAndInsertAt(editor)
        const newOptions: TextOptions = {
          ...options,
          insertAt,
          regenerate: !isSelection
        }

        if (isSelection) {
          newOptions.text = context
        }

        editor.chain().aiEmojify(newOptions).run()
      }
    },
    continueWriting: {
      type: 'executable',
      icon: <CompleteSentenceIcon className="tiptap-button-icon" />,
      label: 'Continue writing',
      value: 'continueWriting',
      onSelect: ({ editor, options }) => {
        if (!editor) return

        const { insertAt, isSelection, context } = getContextAndInsertAt(editor)
        const newOptions: TextOptions = {
          ...options,
          insertAt,
          regenerate: !isSelection
        }

        if (isSelection) {
          newOptions.text = context
        }

        editor.chain().aiComplete(newOptions).run()
      }
    },
    summarize: {
      type: 'executable',
      icon: <SummarizeTextIcon className="tiptap-button-icon" />,
      label: 'Add a summary',
      value: 'summarize',
      onSelect: ({ editor, options }) => {
        if (!editor) return

        const { insertAt, isSelection, context } = getContextAndInsertAt(editor)
        const newOptions: TextOptions = {
          ...options,
          insertAt,
          regenerate: !isSelection
        }

        if (isSelection) {
          newOptions.text = context
        }

        editor.chain().aiSummarize(newOptions).run()
      }
    },
    translateTo: {
      type: 'nested',
      component: LanguageSelectionSubmenu,
      filterItems: true,
      icon: <LanguagesIcon className="tiptap-button-icon" />,
      items: SUPPORTED_LANGUAGES,
      label: 'Languages',
      value: 'translateTo'
    }
  }
}

function mapInteractionContextToActions(
  menuActions: Record<MenuActionIdentifier, EditorMenuAction>
) {
  const convertToMenuAction = (item: EditorMenuAction) => ({
    label: item.label,
    value: item.value,
    icon: item.icon,
    filterItems: item.type === 'nested' ? item.filterItems : undefined
  })

  const grouped: Action[] = [
    {
      label: 'Edit',
      items: Object.values([
        menuActions.adjustTone,
        menuActions.aiFixSpellingAndGrammar,
        menuActions.aiExtend,
        menuActions.aiShorten,
        menuActions.simplifyLanguage,
        menuActions.improveWriting,
        menuActions.emojify
      ]).map(convertToMenuAction)
    },
    {
      label: 'Write',
      items: Object.values([
        menuActions.continueWriting,
        menuActions.summarize,
        menuActions.translateTo
      ]).map(convertToMenuAction)
    }
  ]

  return grouped
}

function isExecutableMenuItem(
  item: EditorMenuAction
): item is ExecutableMenuAction {
  return item.type === 'executable'
}

function isNestedMenuItem(item: EditorMenuAction): item is NestedMenuAction {
  return item.type === 'nested'
}

function LanguageSelectionSubmenu({
  editor
}: {
  editor: Editor | null
}) {
  const [searchValue] = useComboboxValueState()
  const { state, updateState } = useAiMenuState()

  const availableLanguages = useMemo(() => {
    const translationAction = initializeEditorMenuActions()
      .translateTo as NestedMenuAction
    const languageOptions = { items: translationAction.items || [] }
    return filterMenuItems(languageOptions, searchValue)
  }, [searchValue])

  const handleLanguageSelection = useCallback(
    (selectedLanguageCode: Language) => {
      if (!editor) return

      const { insertAt, isSelection, context } = getContextAndInsertAt(editor)

      updateState({ language: selectedLanguageCode })

      const langOptions: TextOptions = {
        stream: true,
        format: 'rich-text',
        insertAt,
        regenerate: !isSelection
      }

      if (state.tone) {
        langOptions.tone = state.tone
      }

      if (isSelection) {
        langOptions.text = context
      }

      editor.chain().aiTranslate(selectedLanguageCode, langOptions).run()
    },
    [editor, state.tone, updateState]
  )

  const languageMenuItems = (
    <>
      {availableLanguages.length > 0 && (
        <MenuGroupLabel>Languages</MenuGroupLabel>
      )}
      {availableLanguages.map((language) => (
        <MenuItem
          key={language.value}
          onClick={() =>
            language.value &&
            handleLanguageSelection(language.value as Language)
          }
          render={
            <Button data-style="ghost">
              <LanguagesIcon className="tiptap-button-icon" />
              <span className="tiptap-button-text">{language.label}</span>
            </Button>
          }
        />
      ))}
    </>
  )

  if (searchValue) {
    return languageMenuItems
  }

  return (
    <Menu
      placement="right"
      trigger={
        <MenuButton
          render={
            <MenuItem
              render={
                <Button data-style="ghost">
                  <LanguagesIcon className="tiptap-button-icon" />
                  <span className="tiptap-button-text">Languages</span>
                  <MenuButtonArrow render={<ChevronRightIcon />} />
                </Button>
              }
            />
          }
        />
      }>
      <MenuContent>
        <ComboboxList>
          <MenuGroup>{languageMenuItems}</MenuGroup>
        </ComboboxList>
      </MenuContent>
    </Menu>
  )
}

function ToneSelectionSubmenu({ editor }: { editor: Editor | null }) {
  const [searchValue] = useComboboxValueState()
  const { state, updateState } = useAiMenuState()

  const availableTones = useMemo(() => {
    const toneAction = initializeEditorMenuActions()
      .adjustTone as NestedMenuAction
    const toneOptions = { items: toneAction.items || [] }
    return filterMenuItems(toneOptions, searchValue)
  }, [searchValue])

  const handleToneSelection = useCallback(
    (selectedTone: string) => {
      if (!editor) return

      const { insertAt, isSelection, context } = getContextAndInsertAt(editor)

      if (!state.tone || state.tone !== selectedTone) {
        updateState({ tone: selectedTone })
      }

      const toneOptions: TextOptions = {
        stream: true,
        format: 'rich-text',
        insertAt,
        regenerate: !isSelection
      }

      if (state.language) {
        toneOptions.language = state.language
      }

      if (isSelection) {
        toneOptions.text = context
      }

      editor.chain().aiAdjustTone(selectedTone, toneOptions).run()
    },
    [editor, state.language, state.tone, updateState]
  )

  const toneMenuItems = availableTones.map((tone) => (
    <MenuItem
      key={tone.value}
      onClick={() => handleToneSelection(tone.value || '')}
      render={
        <Button data-style="ghost">
          <span className="tiptap-button-text">{tone.label}</span>
        </Button>
      }
    />
  ))

  if (searchValue) {
    return toneMenuItems
  }

  return (
    <Menu
      placement="right"
      trigger={
        <MenuButton
          render={
            <MenuItem
              render={
                <Button data-style="ghost">
                  <MicAiIcon className="tiptap-button-icon" />
                  <span className="tiptap-button-text">Adjust Tone</span>
                  <MenuButtonArrow render={<ChevronRightIcon />} />
                </Button>
              }
            />
          }
        />
      }>
      <MenuContent>
        <ComboboxList>
          <MenuGroup>{toneMenuItems}</MenuGroup>
        </ComboboxList>
      </MenuContent>
    </Menu>
  )
}

function MenuActionRenderer({
  menuItem,
  availableActions,
  editor
}: MenuActionRendererProps) {
  const { state } = useAiMenuState()

  if (!menuItem.value) {
    return null
  }

  const editorAction = availableActions[menuItem.value]
  if (!editorAction) {
    return null
  }

  if (isNestedMenuItem(editorAction)) {
    const SubmenuComponent = editorAction.component
    return (
      <SubmenuComponent
        key={menuItem.value}
        editor={editor}
      />
    )
  }

  if (isExecutableMenuItem(editorAction)) {
    const options: TextOptions = {
      stream: true,
      format: 'rich-text',
      language: state.language
    }

    if (state.tone) {
      options.tone = state.tone
    }

    return (
      <MenuItem
        key={menuItem.value}
        onClick={() =>
          editorAction.onSelect({
            editor,
            options
          })
        }
        render={
          <Button data-style="ghost">
            {editorAction.icon}
            <span className="tiptap-button-text">{editorAction.label}</span>
          </Button>
        }
      />
    )
  }

  return null
}

export function AiMenuItems({
  editor: providedEditor
}: {
  editor?: Editor | null
}) {
  const { editor } = useTiptapEditor(providedEditor)
  const [searchValue] = useComboboxValueState()

  const availableMenuActions = useMemo(() => initializeEditorMenuActions(), [])
  const contextualActionGroups = useMemo(
    () => mapInteractionContextToActions(availableMenuActions),
    [availableMenuActions]
  )

  const filteredActionGroups = useMemo(() => {
    return (
      filterMenuGroups(contextualActionGroups, searchValue) ||
      contextualActionGroups
    )
  }, [contextualActionGroups, searchValue])

  const wouldActionRenderContent = useCallback(
    (menuItem: Action) => {
      if (!menuItem.value) return false

      const editorAction =
        availableMenuActions[menuItem.value as MenuActionIdentifier]
      if (!editorAction) return false

      // For nested menu items with filterItems=true, check their internal filtering
      if (
        isNestedMenuItem(editorAction) &&
        editorAction.filterItems &&
        searchValue.trim()
      ) {
        const nestedItems = filterMenuItems(
          { items: editorAction.items || [] },
          searchValue
        )
        return nestedItems.length > 0
      }

      return true
    },
    [availableMenuActions, searchValue]
  )

  if (!editor) {
    return null
  }

  const renderableGroups = filteredActionGroups
    .map((actionGroup) => ({
      ...actionGroup,
      items: actionGroup.items?.filter(wouldActionRenderContent) ?? []
    }))
    .filter((actionGroup) => actionGroup.items.length > 0)

  if (renderableGroups.length === 0) {
    return null
  }

  return renderableGroups.map((actionGroup, groupIndex) => (
    <Fragment key={groupIndex}>
      <MenuGroup key={groupIndex}>
        <MenuGroupLabel>{actionGroup.label}</MenuGroupLabel>
        {actionGroup.items.map((menuItem: Action) => (
          <MenuActionRenderer
            key={menuItem.value || groupIndex}
            menuItem={menuItem}
            availableActions={availableMenuActions}
            editor={editor}
          />
        ))}
      </MenuGroup>
      {groupIndex < renderableGroups.length - 1 && (
        <Separator orientation="horizontal" />
      )}
    </Fragment>
  ))
}
