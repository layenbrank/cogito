import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ComponentProps, HTMLAttributes, ReactElement } from 'react'
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'

import { Button } from '../components/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/tooltip'

type MessageRole = 'user' | 'assistant' | 'system'

type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: MessageRole
}

function Message({ className, from, ...props }: MessageProps) {
  return (
    <div
      data-slot="message"
      className={cn(
        'group flex w-full max-w-[95%] flex-col gap-2',
        from === 'user' ? 'is-user ml-auto justify-end' : 'is-assistant',
        className
      )}
      {...props}
    />
  )
}

type MessageContentProps = HTMLAttributes<HTMLDivElement>

function MessageContent({ children, className, ...props }: MessageContentProps) {
  return (
    <div
      data-slot="message-content"
      className={cn(
        'is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm',
        'group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground',
        'group-[.is-assistant]:text-foreground',
        className
      )}
      {...props}>
      {children}
    </div>
  )
}

type MessageActionsProps = ComponentProps<'div'>

function MessageActions({ className, children, ...props }: MessageActionsProps) {
  return (
    <div
      className={cn('flex items-center gap-1', className)}
      data-slot="message-actions"
      {...props}>
      {children}
    </div>
  )
}

type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string
  label?: string
}

function MessageAction({
  tooltip,
  children,
  label,
  variant = 'ghost',
  size = 'icon-sm',
  ...props
}: MessageActionProps) {
  const button = (
    <Button
      type="button"
      size={size}
      variant={variant}
      {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  )

  if (!tooltip) return button

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={button} />
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

interface MessageBranchContextType {
  currentBranch: number
  totalBranches: number
  goToPrevious: () => void
  goToNext: () => void
  branches: ReactElement[]
  setBranches: (branches: ReactElement[]) => void
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(null)

function useMessageBranch() {
  const context = useContext(MessageBranchContext)
  if (!context) {
    throw new Error('MessageBranch components must be used within MessageBranch')
  }
  return context
}

type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number
  onBranchChange?: (branchIndex: number) => void
}

function MessageBranch({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps) {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch)
  const [branches, setBranches] = useState<ReactElement[]>([])

  const handleBranchChange = useCallback(
    function (newBranch: number) {
      setCurrentBranch(newBranch)
      onBranchChange?.(newBranch)
    },
    [onBranchChange]
  )

  const goToPrevious = useCallback(
    function () {
      const newBranch = currentBranch > 0 ? currentBranch - 1 : branches.length - 1
      handleBranchChange(newBranch)
    },
    [currentBranch, branches.length, handleBranchChange]
  )

  const goToNext = useCallback(
    function () {
      const newBranch = currentBranch < branches.length - 1 ? currentBranch + 1 : 0
      handleBranchChange(newBranch)
    },
    [currentBranch, branches.length, handleBranchChange]
  )

  const contextValue = useMemo(
    function () {
      return {
        branches,
        currentBranch,
        goToNext,
        goToPrevious,
        setBranches,
        totalBranches: branches.length
      }
    },
    [branches, currentBranch, goToNext, goToPrevious]
  )

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div
        className={cn('grid w-full gap-2 [&>div]:pb-0', className)}
        data-slot="message-branch"
        {...props}
      />
    </MessageBranchContext.Provider>
  )
}

type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>

function MessageBranchContent({ children, ...props }: MessageBranchContentProps) {
  const { currentBranch, setBranches, branches } = useMessageBranch()
  const childrenArray = useMemo(
    function () {
      return Array.isArray(children) ? children : [children]
    },
    [children]
  )

  useEffect(
    function () {
      if (branches.length !== childrenArray.length) {
        setBranches(childrenArray.filter(Boolean) as ReactElement[])
      }
    },
    [childrenArray, branches, setBranches]
  )

  return childrenArray.map(function (branch, index) {
    if (!branch) return null
    return (
      <div
        className={cn(
          'grid gap-2 overflow-hidden [&>div]:pb-0',
          index === currentBranch ? 'block' : 'hidden'
        )}
        key={branch.key ?? index}
        {...props}>
        {branch}
      </div>
    )
  })
}

type MessageBranchSelectorProps = ComponentProps<'div'>

function MessageBranchSelector({ className, ...props }: MessageBranchSelectorProps) {
  const { totalBranches } = useMessageBranch()
  if (totalBranches <= 1) return null
  return (
    <div
      className={cn('flex items-center gap-0.5 rounded-md border p-0.5', className)}
      data-slot="message-branch-selector"
      {...props}
    />
  )
}

type MessageBranchPreviousProps = ComponentProps<typeof Button>

function MessageBranchPrevious({ children, ...props }: MessageBranchPreviousProps) {
  const { goToPrevious, totalBranches } = useMessageBranch()
  return (
    <Button
      type="button"
      aria-label="Previous branch"
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon-sm"
      variant="ghost"
      {...props}>
      {children ?? (
        <Icon
          icon="lucide:chevron-left"
          className="size-3.5"
        />
      )}
    </Button>
  )
}

type MessageBranchNextProps = ComponentProps<typeof Button>

function MessageBranchNext({ children, ...props }: MessageBranchNextProps) {
  const { goToNext, totalBranches } = useMessageBranch()
  return (
    <Button
      type="button"
      aria-label="Next branch"
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon-sm"
      variant="ghost"
      {...props}>
      {children ?? (
        <Icon
          icon="lucide:chevron-right"
          className="size-3.5"
        />
      )}
    </Button>
  )
}

type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>

function MessageBranchPage({ className, ...props }: MessageBranchPageProps) {
  const { currentBranch, totalBranches } = useMessageBranch()
  return (
    <span
      className={cn('text-muted-foreground px-1 text-xs tabular-nums', className)}
      {...props}>
      {currentBranch + 1} / {totalBranches}
    </span>
  )
}

type MessageResponseProps = HTMLAttributes<HTMLDivElement>

const MessageResponse = memo(function MessageResponse({
  className,
  children,
  ...props
}: MessageResponseProps) {
  return (
    <div
      data-slot="message-response"
      className={cn('size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}
      {...props}>
      {children}
    </div>
  )
})

type MessageToolbarProps = ComponentProps<'div'>

function MessageToolbar({ className, children, ...props }: MessageToolbarProps) {
  return (
    <div
      className={cn('mt-4 flex w-full items-center justify-between gap-4', className)}
      data-slot="message-toolbar"
      {...props}>
      {children}
    </div>
  )
}

export {
  Message,
  MessageAction,
  MessageActions,
  MessageBranch,
  MessageBranchContent,
  MessageBranchNext,
  MessageBranchPage,
  MessageBranchPrevious,
  MessageBranchSelector,
  MessageContent,
  MessageResponse,
  MessageToolbar
}
export type { MessageActionProps, MessageProps, MessageResponseProps, MessageRole }
