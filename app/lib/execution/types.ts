import { ActionType, ExecutionStatus } from '@prisma/client'

export type ExecutionMode = 'audit' | 'live'

export interface ExecutionRequest {
  executionId: string
  tenantId: string
  opportunityId: string
  actionId: string
  actionType: ActionType
  channel: string
  idempotencyKey: string
  attemptNumber: number
  mode: ExecutionMode

  // Customer / target context
  customer?: {
    id?: string
    name?: string
    email?: string
    phone?: string | null
  } | null

  // Financial context (always in minor units)
  amountMinor: number
  currency: string

  // Content (advisory message from AI or standard template)
  messageSubject?: string
  messageBody?: string
  metadata?: Record<string, unknown>
}

export interface ExecutionResult {
  success: boolean
  status: ExecutionStatus
  externalReference?: string
  failureReason?: string
  isRetryable?: boolean
  providerName: string
  mode: ExecutionMode
  metadata?: Record<string, unknown>
  executedAt: Date
}

export interface RecoveryExecutionProvider {
  name: string
  supports(actionType: ActionType, channel?: string): boolean
  execute(request: ExecutionRequest): Promise<ExecutionResult>
}
