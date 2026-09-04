import prisma from '../prisma'
import { ActionType, OpportunityStatus, PriorityLevel, RecoveryPolicy } from '@prisma/client'
import { PolicyDecision, PolicyEvaluationResult, PolicyReasonCode, TenantPolicyUpdateInput } from './types'
import { logAuditEvent } from '../audit/audit-service'

/**
 * Retrieves the active recovery policy for a tenant.
 * If no policy exists yet in PostgreSQL, creates a safe default policy.
 */
export async function getOrCreateDefaultTenantPolicy(tenantId: string): Promise<RecoveryPolicy> {
  const existing = await prisma.recoveryPolicy.findFirst({
    where: { tenantId, actionType: null },
    orderBy: { createdAt: 'asc' }
  })

  if (existing) {
    return existing
  }

  // Create standard, safe default policy:
  // - ₹10,000 threshold for automatic execution
  // - 1 hour cooldown between attempts on the same opportunity
  // - Maximum 3 attempts
  return prisma.recoveryPolicy.create({
    data: {
      tenantId,
      name: 'Default Tenant Recovery Policy',
      enabled: true,
      autoExecutionEnabled: true,
      maxAmountMinor: 1000000, // ₹10,000 max auto-execute
      minAmountMinor: 0,
      allowedPriorities: [PriorityLevel.LOW, PriorityLevel.MEDIUM, PriorityLevel.HIGH, PriorityLevel.CRITICAL],
      allowedActions: [
        ActionType.RETRY_PAYMENT,
        ActionType.SEND_PAYMENT_REMINDER,
        ActionType.ESCALATE,
        ActionType.CONTACT_CUSTOMER,
        ActionType.RECOVER_CHECKOUT,
        ActionType.RETRY_SUBSCRIPTION
      ],
      allowedProviders: ['simulation', 'resend', 'payment_retry'],
      maxAttempts: 3,
      cooldownSeconds: 3600,
      requiresApproval: false,
      version: 1
    }
  })
}

/**
 * Updates a tenant's recovery policy.
 * Increments the policy version for immutability and audit compliance.
 */
export async function updateTenantPolicy(params: {
  tenantId: string
  policyId?: string
  updates: TenantPolicyUpdateInput
  actorEmail?: string
}): Promise<RecoveryPolicy> {
  const { tenantId, policyId, updates, actorEmail } = params

  let targetPolicy: RecoveryPolicy
  if (policyId) {
    const found = await prisma.recoveryPolicy.findUnique({
      where: { id: policyId }
    })
    if (!found || found.tenantId !== tenantId) {
      throw new Error('Policy not found or access denied')
    }
    targetPolicy = found
  } else {
    targetPolicy = await getOrCreateDefaultTenantPolicy(tenantId)
  }

  const updated = await prisma.recoveryPolicy.update({
    where: { id: targetPolicy.id },
    data: {
      ...updates,
      version: targetPolicy.version + 1,
      updatedBy: actorEmail || 'system'
    }
  })

  await logAuditEvent({
    tenantId,
    eventType: 'POLICY_UPDATED',
    entityType: 'RecoveryPolicy',
    entityId: updated.id,
    metadata: {
      policyVersion: updated.version,
      updates
    }
  })

  return updated
}

/**
 * Toggles the tenant automation kill switch.
 * When disabled, NO automatic executions can proceed.
 */
export async function setTenantAutomationKillSwitch(params: {
  tenantId: string
  enabled: boolean
  actorEmail?: string
}): Promise<RecoveryPolicy> {
  const { tenantId, enabled, actorEmail } = params
  const policy = await getOrCreateDefaultTenantPolicy(tenantId)

  const updated = await prisma.recoveryPolicy.update({
    where: { id: policy.id },
    data: {
      autoExecutionEnabled: enabled,
      version: policy.version + 1,
      updatedBy: actorEmail || 'system'
    }
  })

  await logAuditEvent({
    tenantId,
    eventType: enabled ? 'AUTOMATION_ENABLED' : 'AUTOMATION_DISABLED',
    entityType: 'RecoveryPolicy',
    entityId: updated.id,
    metadata: {
      autoExecutionEnabled: enabled,
      policyVersion: updated.version
    }
  })

  return updated
}

/**
 * Evaluates recovery opportunity against deterministic policy rules.
 * Authoritative:
 * - AI is strictly ignored
 * - Fail closed on error
 * - Machine-readable reason codes
 */
export async function evaluateRecoveryPolicy(params: {
  tenantId: string
  opportunityId: string
  requestedActionType?: ActionType
  requestedProvider?: string
}): Promise<PolicyEvaluationResult> {
  const { tenantId, opportunityId, requestedActionType, requestedProvider } = params
  const now = new Date()

  try {
    // 1. Fetch opportunity with execution and action history
    const opportunity = await prisma.recoveryOpportunity.findUnique({
      where: { id: opportunityId, tenantId },
      include: {
        actions: { orderBy: { createdAt: 'desc' }, take: 1 },
        executions: { orderBy: { createdAt: 'desc' } }
      }
    })

    if (!opportunity) {
      return {
        decision: 'BLOCKED',
        reasonCode: 'OPPORTUNITY_NOT_ACTIVE',
        reason: 'Recovery opportunity not found',
        requiresApproval: false,
        evaluatedAt: now.toISOString()
      }
    }

    // If opportunity is already in a terminal state (RECOVERED, FAILED, DISMISSED), skip evaluation
    if (
      opportunity.status === OpportunityStatus.RECOVERED ||
      opportunity.status === OpportunityStatus.FAILED ||
      opportunity.status === OpportunityStatus.DISMISSED
    ) {
      return {
        decision: 'SKIPPED',
        reasonCode: 'OPPORTUNITY_NOT_ACTIVE',
        reason: `Opportunity is in terminal state '${opportunity.status}'`,
        requiresApproval: false,
        evaluatedAt: now.toISOString()
      }
    }

    // 2. Fetch active tenant policy
    // Check for actionType-specific override first, otherwise fall back to default tenant policy
    let policy = requestedActionType
      ? await prisma.recoveryPolicy.findFirst({
          where: { tenantId, actionType: requestedActionType, enabled: true }
        })
      : null

    if (!policy) {
      policy = await getOrCreateDefaultTenantPolicy(tenantId)
    }

    // 3. Policy Enabled Check
    if (!policy.enabled) {
      return buildPolicyResult({
        decision: 'BLOCKED',
        reasonCode: 'POLICY_DISABLED',
        reason: 'Tenant recovery policy is disabled',
        policy,
        requiresApproval: false,
        now
      })
    }

    // 4. Automation Kill Switch Check
    if (!policy.autoExecutionEnabled) {
      return buildPolicyResult({
        decision: 'BLOCKED',
        reasonCode: 'AUTOMATION_DISABLED',
        reason: 'Tenant automation kill switch is active (Auto-execution disabled)',
        policy,
        requiresApproval: true,
        now
      })
    }

    // 5. Maximum Attempts Governance
    const totalAttempts = opportunity.executions.length
    if (totalAttempts >= policy.maxAttempts) {
      return buildPolicyResult({
        decision: 'BLOCKED',
        reasonCode: 'MAX_ATTEMPTS_EXCEEDED',
        reason: `Opportunity reached maximum allowed execution attempts (${totalAttempts} of ${policy.maxAttempts})`,
        policy,
        requiresApproval: true,
        now
      })
    }

    // 6. Cooldown Governance
    const latestExecution = opportunity.executions[0]
    if (latestExecution && policy.cooldownSeconds > 0) {
      const elapsedSeconds = Math.floor((now.getTime() - latestExecution.createdAt.getTime()) / 1000)
      if (elapsedSeconds < policy.cooldownSeconds) {
        const remaining = policy.cooldownSeconds - elapsedSeconds
        return buildPolicyResult({
          decision: 'BLOCKED',
          reasonCode: 'COOLDOWN_ACTIVE',
          reason: `Opportunity is in cooldown. ${remaining}s remaining of ${policy.cooldownSeconds}s cooldown period`,
          policy,
          requiresApproval: true,
          cooldownRemainingSeconds: remaining,
          now
        })
      }
    }

    // 7. Allowed Priorities Check
    if (!policy.allowedPriorities.includes(opportunity.priority)) {
      return buildPolicyResult({
        decision: 'APPROVAL_REQUIRED',
        reasonCode: 'DISALLOWED_PRIORITY',
        reason: `Priority '${opportunity.priority}' requires manual review under active policy`,
        policy,
        requiresApproval: true,
        now
      })
    }

    // 8. Amount Limits Check
    if (opportunity.amountAtRiskMinor > policy.maxAmountMinor) {
      return buildPolicyResult({
        decision: 'APPROVAL_REQUIRED',
        reasonCode: 'EXCEEDS_MAX_AUTO_AMOUNT',
        reason: `Amount at risk (₹${(opportunity.amountAtRiskMinor / 100).toFixed(2)}) exceeds automatic execution threshold of ₹${(policy.maxAmountMinor / 100).toFixed(2)}`,
        policy,
        requiresApproval: true,
        now
      })
    }

    if (opportunity.amountAtRiskMinor < policy.minAmountMinor) {
      return buildPolicyResult({
        decision: 'BLOCKED',
        reasonCode: 'BELOW_MIN_AMOUNT',
        reason: `Amount at risk is below minimum policy threshold of ₹${(policy.minAmountMinor / 100).toFixed(2)}`,
        policy,
        requiresApproval: false,
        now
      })
    }

    // 9. Allowed Action Check
    const effectiveActionType = requestedActionType || (opportunity.actions[0]?.type as ActionType) || ActionType.RETRY_PAYMENT
    if (!policy.allowedActions.includes(effectiveActionType)) {
      return buildPolicyResult({
        decision: 'APPROVAL_REQUIRED',
        reasonCode: 'DISALLOWED_ACTION_TYPE',
        reason: `Action type '${effectiveActionType}' is not in policy allowed automatic actions`,
        policy,
        requiresApproval: true,
        now
      })
    }

    // 10. Allowed Provider Check
    if (requestedProvider && !policy.allowedProviders.includes(requestedProvider)) {
      return buildPolicyResult({
        decision: 'BLOCKED',
        reasonCode: 'UNSUPPORTED_PROVIDER',
        reason: `Provider '${requestedProvider}' is not allowed or supported by policy`,
        policy,
        requiresApproval: true,
        now
      })
    }

    // 11. Explicit Manual Approval Required Check
    if (policy.requiresApproval) {
      return buildPolicyResult({
        decision: 'APPROVAL_REQUIRED',
        reasonCode: 'MANUAL_APPROVAL_ENFORCED',
        reason: 'Active policy mandates human operator approval for all recoveries',
        policy,
        requiresApproval: true,
        now
      })
    }

    // 12. Approved for Automatic Execution
    return buildPolicyResult({
      decision: 'AUTO_EXECUTE',
      reasonCode: 'WITHIN_AUTO_EXECUTION_LIMITS',
      reason: 'Opportunity meets all deterministic criteria for automatic execution',
      policy,
      requiresApproval: false,
      now
    })

  } catch (err) {
    console.error('[POLICY_EVALUATION_ERROR]', err)
    // FAIL CLOSED: Never silently auto-execute if policy evaluation encounters an error
    return {
      decision: 'BLOCKED',
      reasonCode: 'POLICY_EVALUATION_ERROR',
      reason: 'Policy evaluation failed due to unexpected error. Execution blocked for safety.',
      requiresApproval: true,
      evaluatedAt: now.toISOString()
    }
  }
}

function buildPolicyResult(params: {
  decision: PolicyDecision
  reasonCode: PolicyReasonCode
  reason: string
  policy: RecoveryPolicy
  requiresApproval: boolean
  cooldownRemainingSeconds?: number
  now: Date
}): PolicyEvaluationResult {
  const { decision, reasonCode, reason, policy, requiresApproval, cooldownRemainingSeconds, now } = params

  return {
    decision,
    reasonCode,
    reason,
    policyId: policy.id,
    policyName: policy.name,
    policyVersion: policy.version,
    requiresApproval,
    cooldownRemainingSeconds,
    evaluatedAt: now.toISOString()
  }
}

/**
 * Pure, read-only simulation function that evaluates an arbitrary INR amount
 * against a tenant's active deterministic recovery policy.
 * 
 * GUARANTEES:
 * - Reuses the exact same deterministic rules as evaluateRecoveryPolicy.
 * - ZERO database mutations or records created.
 * - ZERO execution or payment actions triggered.
 * - AI is strictly excluded from decision making.
 */
export async function simulatePolicyAmount(params: {
  tenantId: string
  amountMinor: number
  priority?: PriorityLevel
  actionType?: ActionType
  provider?: string
}): Promise<PolicyEvaluationResult & {
  amountMinor: number
  amountINR: number
  thresholdMinor: number
  thresholdINR: number
}> {
  const {
    tenantId,
    amountMinor,
    priority = PriorityLevel.HIGH,
    actionType = ActionType.RETRY_PAYMENT,
    provider = 'simulation'
  } = params

  const now = new Date()
  const policy = await getOrCreateDefaultTenantPolicy(tenantId)

  // 1. Policy Enabled Check
  if (!policy.enabled) {
    const res = buildPolicyResult({
      decision: 'BLOCKED',
      reasonCode: 'POLICY_DISABLED',
      reason: 'Tenant recovery policy is disabled',
      policy,
      requiresApproval: false,
      now
    })
    return {
      amountMinor,
      amountINR: amountMinor / 100,
      thresholdMinor: policy.maxAmountMinor,
      thresholdINR: policy.maxAmountMinor / 100,
      ...res
    }
  }

  // 2. Automation Kill Switch Check
  if (!policy.autoExecutionEnabled) {
    const res = buildPolicyResult({
      decision: 'BLOCKED',
      reasonCode: 'AUTOMATION_DISABLED',
      reason: 'Tenant automation kill switch is active (Auto-execution disabled)',
      policy,
      requiresApproval: true,
      now
    })
    return {
      amountMinor,
      amountINR: amountMinor / 100,
      thresholdMinor: policy.maxAmountMinor,
      thresholdINR: policy.maxAmountMinor / 100,
      ...res
    }
  }

  // 3. Allowed Priorities Check
  if (!policy.allowedPriorities.includes(priority)) {
    const res = buildPolicyResult({
      decision: 'APPROVAL_REQUIRED',
      reasonCode: 'DISALLOWED_PRIORITY',
      reason: `Priority '${priority}' requires manual review under active policy`,
      policy,
      requiresApproval: true,
      now
    })
    return {
      amountMinor,
      amountINR: amountMinor / 100,
      thresholdMinor: policy.maxAmountMinor,
      thresholdINR: policy.maxAmountMinor / 100,
      ...res
    }
  }

  // 4. Amount Limits Check (Deterministic maxAmountMinor / minAmountMinor)
  if (amountMinor > policy.maxAmountMinor) {
    const res = buildPolicyResult({
      decision: 'APPROVAL_REQUIRED',
      reasonCode: 'EXCEEDS_MAX_AUTO_AMOUNT',
      reason: `Amount (₹${(amountMinor / 100).toLocaleString()}) exceeds automatic execution threshold of ₹${(policy.maxAmountMinor / 100).toLocaleString()}`,
      policy,
      requiresApproval: true,
      now
    })
    return {
      amountMinor,
      amountINR: amountMinor / 100,
      thresholdMinor: policy.maxAmountMinor,
      thresholdINR: policy.maxAmountMinor / 100,
      ...res
    }
  }

  if (amountMinor < policy.minAmountMinor) {
    const res = buildPolicyResult({
      decision: 'BLOCKED',
      reasonCode: 'BELOW_MIN_AMOUNT',
      reason: `Amount is below minimum policy threshold of ₹${(policy.minAmountMinor / 100).toLocaleString()}`,
      policy,
      requiresApproval: false,
      now
    })
    return {
      amountMinor,
      amountINR: amountMinor / 100,
      thresholdMinor: policy.maxAmountMinor,
      thresholdINR: policy.maxAmountMinor / 100,
      ...res
    }
  }

  // 5. Allowed Action Check
  if (!policy.allowedActions.includes(actionType)) {
    const res = buildPolicyResult({
      decision: 'APPROVAL_REQUIRED',
      reasonCode: 'DISALLOWED_ACTION_TYPE',
      reason: `Action type '${actionType}' is not in policy allowed automatic actions`,
      policy,
      requiresApproval: true,
      now
    })
    return {
      amountMinor,
      amountINR: amountMinor / 100,
      thresholdMinor: policy.maxAmountMinor,
      thresholdINR: policy.maxAmountMinor / 100,
      ...res
    }
  }

  // 6. Allowed Provider Check
  if (provider && !policy.allowedProviders.includes(provider)) {
    const res = buildPolicyResult({
      decision: 'BLOCKED',
      reasonCode: 'UNSUPPORTED_PROVIDER',
      reason: `Provider '${provider}' is not allowed or supported by policy`,
      policy,
      requiresApproval: true,
      now
    })
    return {
      amountMinor,
      amountINR: amountMinor / 100,
      thresholdMinor: policy.maxAmountMinor,
      thresholdINR: policy.maxAmountMinor / 100,
      ...res
    }
  }

  // 7. Explicit Manual Approval Required Check
  if (policy.requiresApproval) {
    const res = buildPolicyResult({
      decision: 'APPROVAL_REQUIRED',
      reasonCode: 'MANUAL_APPROVAL_ENFORCED',
      reason: 'Active policy mandates human operator approval for all recoveries',
      policy,
      requiresApproval: true,
      now
    })
    return {
      amountMinor,
      amountINR: amountMinor / 100,
      thresholdMinor: policy.maxAmountMinor,
      thresholdINR: policy.maxAmountMinor / 100,
      ...res
    }
  }

  // 8. Approved for Automatic Execution
  const res = buildPolicyResult({
    decision: 'AUTO_EXECUTE',
    reasonCode: 'WITHIN_AUTO_EXECUTION_LIMITS',
    reason: 'Amount meets all deterministic criteria for automatic execution',
    policy,
    requiresApproval: false,
    now
  })
  return {
    amountMinor,
    amountINR: amountMinor / 100,
    thresholdMinor: policy.maxAmountMinor,
    thresholdINR: policy.maxAmountMinor / 100,
    ...res
  }
}

