/** Local tool call lifecycle states (no AI SDK dependency). */
type ToolCallState =
  | 'approval-requested'
  | 'approval-responded'
  | 'input-available'
  | 'input-streaming'
  | 'output-available'
  | 'output-denied'
  | 'output-error'

/** Mirrors AI Elements `Confirmation` approval shape (not `@ai-sdk/*`). */
type ToolApprovalRecord =
  | {
      id: string
      approved?: never
      reason?: never
    }
  | {
      id: string
      approved: boolean
      reason?: string
    }
  | undefined

export type { ToolApprovalRecord, ToolCallState }
