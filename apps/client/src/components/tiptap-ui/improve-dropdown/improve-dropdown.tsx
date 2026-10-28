import { useMemo } from 'react'
import { type Editor } from '@tiptap/react'
import type { TextOptions, Tone } from '@tiptap-pro/extension-ai'

// --- Hooks ---
import {
  useImproveDropdown,
  type AICommand
} from '@/components/tiptap-ui/improve-dropdown/use-improve-dropdown.ts'

// --- Icons ---
import { MicAiIcon } from '@/components/tiptap-icons/mic-ai-icon.tsx'
import { AiSparklesIcon } from '@/components/tiptap-icons/ai-sparkles-icon.tsx'
import { CheckAiIcon } from '@/components/tiptap-icons/check-ai-icon.tsx'
import { TextExtendIcon } from '@/components/tiptap-icons/text-extend-icon.tsx'
import { TextReduceIcon } from '@/components/tiptap-icons/text-reduce-icon.tsx'
import { Simplify2Icon } from '@/components/tiptap-icons/simplify-2-icon.tsx'
import { SmileAiIcon } from '@/components/tiptap-icons/smile-ai-icon.tsx'
import { CompleteSentenceIcon } from '@/components/tiptap-icons/complete-sentence-icon.tsx'
import { SummarizeTextIcon } from '@/components/tiptap-icons/summarize-text-icon.tsx'
import { LanguagesIcon } from '@/components/tiptap-icons/languages-icon.tsx'
import { ChevronRightIcon } from '@/components/tiptap-icons/chevron-right-icon.tsx'

// --- Tiptap UI ---
import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_TONES
} from '@/components/tiptap-ui/ai-menu/ai-menu-items/ai-menu-items-constants.ts'
import { AiAskButton } from '@/components/tiptap-ui/ai-ask-button/ai-ask-button.tsx'

// --- UI Primitives ---
import type { ButtonProps } from '@/components/tiptap-ui-primitive/button/button.tsx'
import {
  Button,
  ButtonGroup
} from '@/components/tiptap-ui-primitive/button/button.tsx'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent
} from '@/components/tiptap-ui-primitive/dropdown-menu/dropdown-menu.tsx'
import { Card, CardBody } from '@/components/tiptap-ui-primitive/card/card.tsx'
import { Separator } from '@/components/tiptap-ui-primitive/separator/separator.tsx'
import { t } from '@/views/knowledge/locale.ts'

export interface ToneOption {
  label: string
  value: Tone
  icon?: React.ComponentType<{ className?: string }>
}

export interface ImproveDropdownProps extends Omit<ButtonProps, 'type'> {
  /**
   * Optional editor instance. If not provided, will use editor from context
   */
  editor?: Editor
  /**
   * List of AI command types to show in the dropdown.
   */
  types?: Tone[]
  /**
   * Optional text options for AI commands
   * @default { stream: true, format: "rich-text" }
   */
  textOptions?: TextOptions
  /**
   * Whether to hide the dropdown when AI features are not available
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Whether to render the dropdown menu in a portal
   * @default false
   */
  portal?: boolean
}

interface MenuAction {
  icon: React.ComponentType<{ className?: string }>
  label: string
  command: AICommand
  onClick: () => void
}

interface SubMenuAction {
  icon: React.ComponentType<{ className?: string }>
  label: string
  items: Array<{
    label: string
    value: string
    icon?: React.ComponentType<{ className?: string }>
    onClick: () => void
  }>
}

function SubMenuButton({ action }: { action: SubMenuAction }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger asChild>
        <Button
          data-style="ghost"
          type="button">
          <action.icon className="size-3.5 shrink-0" />
          <span className="truncate text-xs">{action.label}</span>
          <ChevronRightIcon className="tiptap-button-icon-sub" />
        </Button>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <Card>
          <CardBody>
            <ButtonGroup>
              {action.items.map((item) => (
                <DropdownMenuItem
                  key={item.value}
                  asChild>
                  <Button
                    type="button"
                    data-style="ghost"
                    onClick={item.onClick}>
                    {item.icon && <item.icon className="size-3.5 shrink-0" />}
                    <span className="truncate text-xs">{item.label}</span>
                  </Button>
                </DropdownMenuItem>
              ))}
            </ButtonGroup>
          </CardBody>
        </Card>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

export function ImproveDropdown({
  editor: providedEditor,
  hideWhenUnavailable = false,
  textOptions,
  portal = false,
  ...props
}: ImproveDropdownProps) {
  const {
    isVisible,
    isDisabled,
    isOpen,
    handleOpenChange,
    executeAICommand,
    adjustTone,
    translate
  } = useImproveDropdown({
    editor: providedEditor,
    hideWhenUnavailable,
    textOptions
  })

  const menuActions: MenuAction[] = useMemo(
    () => [
      {
        icon: CheckAiIcon,
        label: t('EDITOR_FIX_SPELLING'),
        command: 'fixSpellingAndGrammar',
        onClick: () => executeAICommand('fixSpellingAndGrammar')
      },
      {
        icon: TextExtendIcon,
        label: t('EDITOR_EXTEND_TEXT'),
        command: 'extend',
        onClick: () => executeAICommand('extend')
      },
      {
        icon: TextReduceIcon,
        label: t('EDITOR_REDUCE_TEXT'),
        command: 'shorten',
        onClick: () => executeAICommand('shorten')
      },
      {
        icon: Simplify2Icon,
        label: t('EDITOR_SIMPLIFY_TEXT'),
        command: 'simplify',
        onClick: () => executeAICommand('simplify')
      },
      {
        icon: SmileAiIcon,
        label: t('EDITOR_EMOJIFY'),
        command: 'emojify',
        onClick: () => executeAICommand('emojify')
      }
    ],
    [executeAICommand]
  )

  const secondaryActions: MenuAction[] = useMemo(
    () => [
      {
        icon: CompleteSentenceIcon,
        label: t('EDITOR_COMPLETE_SENTENCE'),
        command: 'complete',
        onClick: () => executeAICommand('complete')
      },
      {
        icon: SummarizeTextIcon,
        label: t('EDITOR_SUMMARIZE'),
        command: 'summarize',
        onClick: () => executeAICommand('summarize')
      }
    ],
    [executeAICommand]
  )

  const subMenuActions: SubMenuAction[] = useMemo(
    () => [
      {
        icon: MicAiIcon,
        label: t('EDITOR_ADJUST_TONE'),
        items: SUPPORTED_TONES.map((option) => ({
          label: option.label,
          value: option.value,
          onClick: () => adjustTone(option.value)
        }))
      }
    ],
    [adjustTone]
  )

  const translateSubMenu: SubMenuAction = useMemo(
    () => ({
      icon: LanguagesIcon,
      label: t('EDITOR_TRANSLATE'),
      items: SUPPORTED_LANGUAGES.map((option) => ({
        label: option.label,
        value: option.value,
        icon: LanguagesIcon,
        onClick: () => translate(option.value)
      }))
    }),
    [translate]
  )

  if (!isVisible) {
    return null
  }

  return (
    <DropdownMenu
      modal
      open={isOpen}
      onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          data-style="ghost"
          disabled={isDisabled}
          data-disabled={isDisabled}
          role="button"
          tabIndex={-1}
          aria-label={t('EDITOR_IMPROVE')}
          tooltip={t('EDITOR_IMPROVE')}
          {...props}>
          <AiSparklesIcon className="size-3.5 shrink-0" />
          <span className="truncate text-xs">Improve</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        portal={portal}>
        <Card>
          <CardBody>
            <ButtonGroup>
              {subMenuActions.map((action) => (
                <SubMenuButton
                  key={action.label}
                  action={action}
                />
              ))}

              {menuActions.map((action) => (
                <DropdownMenuItem
                  key={action.command}
                  asChild>
                  <Button
                    type="button"
                    data-style="ghost"
                    onClick={action.onClick}>
                    <action.icon className="size-3.5 shrink-0" />
                    <span className="truncate text-xs">{action.label}</span>
                  </Button>
                </DropdownMenuItem>
              ))}
            </ButtonGroup>

            <Separator orientation="horizontal" />

            <ButtonGroup>
              <DropdownMenuItem asChild>
                <AiAskButton
                  text={t('EDITOR_ASK_AI')}
                  showTooltip={false}
                />
              </DropdownMenuItem>

              {secondaryActions.map((action) => (
                <DropdownMenuItem
                  key={action.command}
                  asChild>
                  <Button
                    type="button"
                    data-style="ghost"
                    onClick={action.onClick}>
                    <action.icon className="size-3.5 shrink-0" />
                    <span className="truncate text-xs">{action.label}</span>
                  </Button>
                </DropdownMenuItem>
              ))}

              <SubMenuButton action={translateSubMenu} />
            </ButtonGroup>
          </CardBody>
        </Card>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default ImproveDropdown
