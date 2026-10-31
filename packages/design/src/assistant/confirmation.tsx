import { cn } from 'cn'
import type { ComponentProps, ReactNode } from 'react'
import { createContext, useContext, useMemo } from 'react'

import { Alert, AlertDescription } from '../components/alert'
import { Button } from '../components/button'
import type { ToolApprovalRecord, ToolCallState } from './tool-call-state'

interface ConfirmationContextValue {
  approval: ToolApprovalRecord
  state: ToolCallState
}

const ConfirmationContext = createContext<ConfirmationContextValue | null>(null)

function useConfirmation() {
  const context = useContext(ConfirmationContext)
  if (!context) {
    throw new Error('Confirmation components must be used within Confirmation')
  }
  return context
}

type ConfirmationProps = ComponentProps<typeof Alert> & {
  approval?: ToolApprovalRecord
  state: ToolCallState
}

function Confirmation({ className, approval, state, ...props }: ConfirmationProps) {
  const contextValue = useMemo(
    function () {
      return { approval, state }
    },
    [approval, state]
  )

  if (!approval || state === 'input-streaming' || state === 'input-available') {
    return null
  }

  return (
    <ConfirmationContext.Provider value={contextValue}>
      <Alert
        className={cn('flex flex-col gap-2', className)}
        data-slot="confirmation"
        {...props}
      />
    </ConfirmationContext.Provider>
  )
}

type ConfirmationTitleProps = ComponentProps<typeof AlertDescription>

function ConfirmationTitle({ className, ...props }: ConfirmationTitleProps) {
  return (
    <AlertDescription
      className={cn('inline text-foreground', className)}
      data-slot="confirmation-title"
      {...props}
    />
  )
}

interface ConfirmationRequestProps {
  children?: ReactNode
}

function ConfirmationRequest({ children }: ConfirmationRequestProps) {
  const { state } = useConfirmation()
  if (state !== 'approval-requested') return null
  return children
}

interface ConfirmationAcceptedProps {
  children?: ReactNode
}

function ConfirmationAccepted({ children }: ConfirmationAcceptedProps) {
  const { approval, state } = useConfirmation()
  if (
    !approval?.approved ||
    (state !== 'approval-responded' && state !== 'output-denied' && state !== 'output-available')
  ) {
    return null
  }
  return children
}

interface ConfirmationRejectedProps {
  children?: ReactNode
}

function ConfirmationRejected({ children }: ConfirmationRejectedProps) {
  const { approval, state } = useConfirmation()
  if (
    approval?.approved !== false ||
    (state !== 'approval-responded' && state !== 'output-denied' && state !== 'output-available')
  ) {
    return null
  }
  return children
}

type ConfirmationActionsProps = ComponentProps<'div'>

function ConfirmationActions({ className, ...props }: ConfirmationActionsProps) {
  const { state } = useConfirmation()
  if (state !== 'approval-requested') return null
  return (
    <div
      className={cn('flex items-center justify-end gap-2 self-end', className)}
      data-slot="confirmation-actions"
      {...props}
    />
  )
}

type ConfirmationActionProps = ComponentProps<typeof Button>

function ConfirmationAction(props: ConfirmationActionProps) {
  return (
    <Button
      className="h-8 px-3 text-sm"
      type="button"
      data-slot="confirmation-action"
      {...props}
    />
  )
}

export {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle
}
export type {
  ConfirmationActionProps,
  ConfirmationActionsProps,
  ConfirmationProps,
  ConfirmationTitleProps
}
