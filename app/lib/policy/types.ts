import { ActionType, PriorityLevel } from '@prisma/client'

export type PolicyDecision = 'AUTO_EXECUTE' | 'APPROVAL_REQUIRED' | 'BLOCKED' | 'SKIPPED'

export type PolicyReasonCode =
  | 'WITHIN_AUTO_EXECUTION_LIMITS'
  | 'EXCEEDS_MAX_AUTO_AMOUNT'
  | 'BELOW_MIN_AMOUNT'
  | 'DISALLOWED_PRIORITY'
  | 'DISALLOWED_ACTION_TYPE'
  | 'UNSUPPORTED_PROVIDER'
  | 'AUTOMATION_DISABLED'
  | 'POLICY_DISABLED'
  | 'MANUAL_APPROVAL_ENFORCED'
  | 'COOLDOWN_ACTIVE'
  | 'MAX_ATTEMPTS_EXCEEDED'
  | 'OPPORTUNITY_NOT_ACTIVE'
  | 'POLICY_EVALUATION_ERROR'

export interface PolicyEvaluationResult {
  decision: PolicyDecision
  reasonCode: PolicyReasonCode
  reason: string
  policyId?: string
  policyName?: string
  policyVersion?: number
  requiresApproval: boolean
  cooldownRemainingSeconds?: number
  evaluatedAt: string
}

export interface TenantPolicyUpdateInput {
  name?: string
  enabled?: boolean
  autoExecutionEnabled?: boolean
  maxAmountMinor?: number
  minAmountMinor?: number
  allowedPriorities?: PriorityLevel[]
  allowedActions?: ActionType[]
  allowedProviders?: string[]
  maxAttempts?: number
  cooldownSeconds?: number
  requiresApproval?: boolean
}
