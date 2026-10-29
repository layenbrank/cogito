'use client'

import { useCallback, useState } from 'react'

import { Button } from '@cogito/design/components/button'

// Tiptap Cogito Extensions
import type { Tone } from '@tiptap-pro/extension-ai'

// Icons
import { MicAiIcon } from '@/components/tiptap-icons/mic-ai-icon.tsx'
import { ArrowUpIcon } from '@/components/tiptap-icons/arrow-up-icon.tsx'
import { AiSparklesIcon } from '@/components/tiptap-icons/ai-sparkles-icon.tsx'

// UI Components
import { SUPPORTED_TONES } from '@/components/tiptap-ui/ai-menu/ai-menu-items/ai-menu-items-constants.ts'

// UI Primitives
import {
  Button as TipTapButton,
  ButtonGroup
} from '@/components/tiptap-ui-primitive/button/button.tsx'
import { Spacer } from '@/components/tiptap-ui-primitive/spacer/spacer.tsx'
import {
  Toolbar,
  ToolbarGroup
} from '@/components/tiptap-ui-primitive/toolbar/toolbar.tsx'
import { useComboboxValueState } from '@/components/tiptap-ui-primitive/menu/menu-hooks.ts'
import { Combobox } from '@/components/tiptap-ui-primitive/combobox/combobox.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/tiptap-ui-primitive/dropdown-menu/dropdown-menu.tsx'
import { TextareaAutosize } from '@/components/tiptap-ui-primitive/textarea-autosize/textarea-autosize.tsx'
import { Card, CardBody } from '@/components/tiptap-ui-primitive/card/card.tsx'

import {
  useBlurHandler,
  useKeyboardHandlers
} from '@/components/tiptap-ui/ai-menu/ai-menu-input/ai-menu-input-hooks.ts'
import type { AiMenuInputTextareaProps } from '@/components/tiptap-ui/ai-menu/ai-menu-input/ai-menu-input-types.ts'

// Styles
import '@/components/tiptap-ui/ai-menu/ai-menu-input/ai-menu-input.scss'

export function AiMenuInputPlaceholder({
  onPlaceholderClick
}: {
  onPlaceholderClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="tiptap-ai-prompt-input-placeholder h-auto w-full justify-between rounded-none border-none p-0 hover:bg-transparent active:bg-transparent"
      onClick={onPlaceholderClick}>
      <div className="tiptap-ai-prompt-input-placeholder-content">
        <AiSparklesIcon className="tiptap-ai-prompt-input-placeholder-icon" />
        <span className="tiptap-ai-prompt-input-placeholder-text">
          {t('EDITOR_AI_CHANGE_PLACEHOLDER')}
        </span>
      </div>
      <span
        aria-hidden
        className="pointer-events-none inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground opacity-50">
        <ArrowUpIcon className="size-3.5 shrink-0" />
      </span>
    </Button>
  )
}

export function ToneSelector({
  tone,
  onToneChange
}: {
  tone: Tone | null
  onToneChange: (tone: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TipTapButton
          type="button"
          data-style="ghost"
          data-active-state={tone ? 'on' : 'off'}
          role="button"
          tabIndex={-1}
          aria-label={t('EDITOR_TONE_OPTIONS')}>
          <MicAiIcon className="size-3.5 shrink-0" />
          <span className="truncate text-xs">{t('EDITOR_TONE')}</span>
        </TipTapButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        <Card>
          <CardBody>
            <ButtonGroup>
              {SUPPORTED_TONES.map((supportedTone) => (
                <DropdownMenuItem
                  key={supportedTone.value}
                  asChild>
                  <TipTapButton
                    data-style="ghost"
                    data-active-state={
                      tone === supportedTone.value ? 'on' : 'off'
                    }
                    onClick={() => onToneChange(supportedTone.value)}>
                    <span className="truncate text-xs">
                      {supportedTone.label}
                    </span>
                  </TipTapButton>
                </DropdownMenuItem>
              ))}
            </ButtonGroup>
          </CardBody>
        </Card>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AiPromptInputToolbar({
  showPlaceholder,
  onInputSubmit,
  onToneChange,
  isEmpty = false
}: {
  showPlaceholder?: boolean
  onInputSubmit: (prompt: string) => void
  onToneChange?: (tone: string) => void
  isEmpty?: boolean
}) {
  const [tone, setTone] = useState<Tone | null>(null)
  const [promptValue] = useComboboxValueState()

  const handleToneChange = useCallback(
    (newTone: string) => {
      setTone(newTone)
      onToneChange?.(newTone)
    },
    [onToneChange]
  )

  const handleSubmit = useCallback(() => {
    onInputSubmit(promptValue)
  }, [onInputSubmit, promptValue])

  return (
    <Toolbar
      variant="floating"
      data-plain="true"
      className="tiptap-ai-prompt-input-toolbar"
      style={{ display: showPlaceholder ? 'none' : 'flex' }}>
      <ToolbarGroup>
        <ToneSelector
          tone={tone}
          onToneChange={handleToneChange}
        />
      </ToolbarGroup>

      <Spacer />

      <ToolbarGroup>
        <TipTapButton
          onClick={handleSubmit}
          disabled={isEmpty}
          data-style="primary"
          aria-label={t('EDITOR_AI_SUBMIT')}>
          <ArrowUpIcon className="size-3.5 shrink-0" />
        </TipTapButton>
      </ToolbarGroup>
    </Toolbar>
  )
}

export function AiMenuInputTextarea({
  onInputSubmit,
  onToneChange,
  onClose,
  onInputFocus,
  onInputBlur,
  onEmptyBlur,
  onPlaceholderClick,
  showPlaceholder = false,
  placeholder = t('EDITOR_AI_PLACEHOLDER'),
  ...props
}: AiMenuInputTextareaProps) {
  const [promptValue, setPromptValue] = useComboboxValueState()
  const [isFocused, setIsFocused] = useState(false)

  const handleSubmit = useCallback(() => {
    const cleanedPrompt = promptValue?.trim()
    if (cleanedPrompt) {
      onInputSubmit(cleanedPrompt)
      setPromptValue('')
    }
  }, [onInputSubmit, promptValue, setPromptValue])

  const handleKeyDown = useKeyboardHandlers(promptValue, onClose, handleSubmit)

  const handleBlur = useBlurHandler(
    promptValue.trim() === '',
    onInputBlur,
    onEmptyBlur
  )

  const handleOnPlaceholderClick = useCallback(() => {
    if (onPlaceholderClick) {
      onPlaceholderClick()
    }
  }, [onPlaceholderClick])

  const handleFocus = useCallback(() => {
    setIsFocused(true)
    if (onInputFocus) {
      onInputFocus()
    }
  }, [onInputFocus])

  const handleTextareaBlur = useCallback(
    (e: React.FocusEvent<HTMLTextAreaElement>) => {
      setIsFocused(false)
      handleBlur(e)
    },
    [handleBlur]
  )

  return (
    <div
      className="tiptap-ai-prompt-input"
      data-focused={isFocused}
      data-active-state={showPlaceholder ? 'off' : 'on'}
      {...props}>
      {showPlaceholder ? (
        <AiMenuInputPlaceholder onPlaceholderClick={handleOnPlaceholderClick} />
      ) : (
        <>
          <Combobox
            autoSelect="always"
            autoFocus
            render={
              <TextareaAutosize
                onChange={(e) => setPromptValue(e.target.value)}
                value={promptValue}
                onKeyDown={handleKeyDown}
                onFocus={handleFocus}
                onBlur={handleTextareaBlur}
                className="tiptap-ai-prompt-input-content"
                placeholder={placeholder}
                autoFocus
                style={{
                  display: showPlaceholder ? 'none' : 'flex'
                }}
              />
            }
          />

          <AiPromptInputToolbar
            showPlaceholder={showPlaceholder}
            onInputSubmit={handleSubmit}
            onToneChange={onToneChange}
            isEmpty={!promptValue?.trim()}
          />
        </>
      )}
    </div>
  )
}

import { t } from '@/views/knowledge/locale.ts'