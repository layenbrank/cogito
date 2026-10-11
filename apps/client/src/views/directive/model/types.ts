import type {
  Condition,
  DirectiveContent,
  DirectiveInput,
  OnError,
  Step as IpcStep,
  StepsStep as IpcStepsStep
} from '@/shared/ipc/specs/sidecar'

interface StepToken {
  token?: string
}

type Step = IpcStep & StepToken
type StepsStep = IpcStepsStep & StepToken

export type { Condition, DirectiveContent, DirectiveInput, OnError, Step, StepsStep }
