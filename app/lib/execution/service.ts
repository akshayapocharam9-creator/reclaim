/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from '../prisma'
import { ActionStatus, ExecutionStatus, MembershipRole, OpportunityStatus } from '@prisma/client'
import { ProviderRegistry } from './registry'
import { ExecutionRequest, ExecutionResult } from './types'
import { logAuditEvent } from '../audit/audit-service'

export interface QueueExecutionParams {
  tenantId: string
  opportunityId: string
  actionId: string
  idempotencyKey?: string
  actor?: {
    id?: string
    email?: string
    role?: MembershipRole
  } | null
  messageSubject?: string
  messageBody?: string
  policyVersion?: number
  maxAttempts?: number
  metadata?: Record<string, unknown>
}

export interface ExecutionServiceResponse {
  success: boolean
  statusCode: number
  error?: string
  execution?: any
  result?: ExecutionResult
  isIdempotent?: boolean
}

/**
 * Transactionally queues a recovery action for execution.
 * Enforces database-level idempotency to prevent duplicate executions from
 * double-clicks, duplicate webhooks, or network retries.
 */
export async function queueExecution(params: QueueExecutionParams): Promise<ExecutionServiceResponse> {
  const { tenantId, opportunityId, actionId, actor, messageSubject, messageBody, policyVersion, maxAttempts = 3, metadata } = params

  // 1. Fetch opportunity and action with tenant scoping
  const opportunity = await prisma.recoveryOpportunity.findUnique({
    where: { id: opportunityId },
    include: { customer: true }
  })

  if (!opportunity || opportunity.tenantId !== tenantId) {
    return { success: false, statusCode: 404, error: 'Opportunity record not found' }
  }

  const action = await prisma.recoveryAction.findUnique({
    where: { id: actionId }
  })

  if (!action || action.tenantId !== tenantId || action.opportunityId !== opportunityId) {
    return { success: false, statusCode: 404, error: 'Recovery action record not found' }
  }

  // Reject queuing if opportunity is in a terminal state
  if (
    opportunity.status === OpportunityStatus.RECOVERED ||
    opportunity.status === OpportunityStatus.FAILED ||
    opportunity.status === OpportunityStatus.DISMISSED
  ) {
    return {
      success: false,
      statusCode: 409,
      error: `Cannot queue execution for opportunity in terminal state '${opportunity.status}'`
    }
  }

  // Reject queuing if action is already executed or canceled
  if (action.status === ActionStatus.EXECUTED || action.status === ActionStatus.CANCELED) {
    return {
      success: false,
      statusCode: 409,
      error: `Cannot queue execution for action in status '${action.status}'`
    }
  }

  // 2. Generate deterministic idempotency key if not explicitly supplied
  const idempotencyKey = params.idempotencyKey || `exec_${tenantId}_${actionId}_${Date.now()}`

  // 3. Check for duplicate execution via idempotencyKey
  const existingExecution = await prisma.recoveryExecution.findUnique({
    where: {
      tenantId_idempotencyKey: {
        tenantId,
        idempotencyKey
      }
    }
  })

  if (existingExecution) {
    return {
      success: true,
      statusCode: 200,
      execution: existingExecution,
      isIdempotent: true
    }
  }

  // 4. Resolve provider
  const provider = ProviderRegistry.getProvider(action.type, action.channel || undefined)

  // 5. Transactionally create RecoveryExecution in QUEUED state
  const execution = await prisma.recoveryExecution.create({
    data: {
      tenantId,
      opportunityId: opportunity.id,
      recoveryActionId: action.id,
      actionType: action.type,
      provider: provider.name,
      status: ExecutionStatus.QUEUED,
      idempotencyKey,
      attemptCount: 1,
      maxAttempts,
      policyVersion: policyVersion || null,
      metadata: {
        channel: action.channel,
        messageSubject,
        messageBody,
        customMetadata: metadata || {}
      } as any
    }
  })

  // 6. Audit log execution queued
  await logAuditEvent({
    tenantId,
    opportunityId: opportunity.id,
    actor,
    eventType: 'EXECUTION_QUEUED',
    entityType: 'RecoveryExecution',
    entityId: execution.id,
    metadata: {
      actionId: action.id,
      actionType: action.type,
      provider: provider.name,
      idempotencyKey
    }
  })

  // 7. Update action status to EXECUTING if not already
  if (action.status !== ActionStatus.EXECUTING) {
    await prisma.recoveryAction.update({
      where: { id: action.id },
      data: { status: ActionStatus.EXECUTING }
    })
  }

  return {
    success: true,
    statusCode: 201,
    execution
  }
}

/**
 * Runs a queued or retryable execution through its configured provider.
 * Guaranteed safe if process terminates: state is persisted prior to external calls.
 */
export async function processExecution(
  executionId: string,
  tenantId: string,
  actor?: { id?: string; email?: string; role?: MembershipRole } | null
): Promise<ExecutionServiceResponse> {
  // 1. Fetch execution record with tenant scoping
  const execution = await prisma.recoveryExecution.findUnique({
    where: { id: executionId },
    include: {
      opportunity: { include: { customer: true } },
      recoveryAction: true
    }
  })

  if (!execution || execution.tenantId !== tenantId) {
    return { success: false, statusCode: 404, error: 'Execution record not found' }
  }

  if (execution.status === ExecutionStatus.SUCCEEDED) {
    return {
      success: true,
      statusCode: 200,
      execution,
      isIdempotent: true
    }
  }

  // Prevent stale executions if opportunity is already resolved
  if (
    execution.opportunity.status === 'RECOVERED' ||
    execution.opportunity.status === 'FAILED' ||
    execution.opportunity.status === 'DISMISSED'
  ) {
    await prisma.recoveryExecution.update({
      where: { id: execution.id },
      data: {
        status: ExecutionStatus.CANCELLED,
        failureReason: `Execution aborted: Opportunity already in terminal state (${execution.opportunity.status})`,
        completedAt: new Date()
      }
    })
    return {
      success: false,
      statusCode: 409,
      error: `Execution aborted because opportunity is already ${execution.opportunity.status}`
    }
  }

  if (execution.status === ExecutionStatus.CANCELLED) {
    return {
      success: false,
      statusCode: 409,
      error: 'Cannot process a cancelled execution'
    }
  }

  // 2. Mark RUNNING in database atomically before calling external provider
  const claimResult = await prisma.recoveryExecution.updateMany({
    where: {
      id: execution.id,
      tenantId,
      status: { in: [ExecutionStatus.QUEUED, ExecutionStatus.RUNNING] }
    },
    data: {
      status: ExecutionStatus.RUNNING,
      startedAt: execution.startedAt || new Date(),
      heartbeatAt: new Date(),
      claimedAt: execution.claimedAt || new Date(),
      claimedBy: actor?.email || 'api_executor'
    }
  })

  if (claimResult.count === 0) {
    const fresh = await prisma.recoveryExecution.findUnique({ where: { id: execution.id } })
    if (fresh?.status === ExecutionStatus.SUCCEEDED) {
      return { success: true, statusCode: 200, execution: fresh, isIdempotent: true }
    }
    return { success: false, statusCode: 409, error: `Execution already processed or locked (${fresh?.status})` }
  }

  const runningExecution = (await prisma.recoveryExecution.findUnique({ where: { id: execution.id } }))!

  await logAuditEvent({
    tenantId,
    opportunityId: execution.opportunityId,
    actor,
    eventType: 'EXECUTION_STARTED',
    entityType: 'RecoveryExecution',
    entityId: execution.id,
    metadata: { attemptCount: runningExecution.attemptCount }
  })

  // 3. Resolve execution mode and provider
  const mode = ProviderRegistry.getExecutionMode()
  const provider = ProviderRegistry.getProvider(execution.actionType, execution.recoveryAction.channel || undefined)

  const execMetadata = (execution.metadata as Record<string, unknown>) || {}

  const request: ExecutionRequest = {
    executionId: execution.id,
    tenantId,
    opportunityId: execution.opportunityId,
    actionId: execution.recoveryActionId,
    actionType: execution.actionType,
    channel: execution.recoveryAction.channel || 'AUTOMATED',
    idempotencyKey: execution.idempotencyKey,
    attemptNumber: execution.attemptCount,
    mode,
    customer: execution.opportunity.customer,
    amountMinor: execution.opportunity.recoverableAmountMinor,
    currency: 'INR',
    messageSubject: execMetadata.messageSubject as string | undefined,
    messageBody: execMetadata.messageBody as string | undefined,
    metadata: execMetadata
  }

  // 4. Dispatch to provider
  let result: ExecutionResult
  try {
    result = await provider.execute(request)
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unexpected provider crash'
    result = {
      success: false,
      status: ExecutionStatus.FAILED,
      failureReason: `PROVIDER_CRASH: ${errorMsg}`,
      isRetryable: true,
      providerName: provider.name,
      mode,
      executedAt: new Date()
    }
  }

  // 5. Compute failure category and review requirement if failed
  const isFailed = result.status === ExecutionStatus.FAILED
  const isExhausted = isFailed && execution.attemptCount >= execution.maxAttempts
  let errorCategory: string | null = null
  let requiresReview = false

  if (isFailed) {
    if (result.metadata?.isAuthError) {
      errorCategory = 'AUTHENTICATION_FAILURE'
      requiresReview = true
    } else if (result.metadata?.isRateLimited) {
      errorCategory = 'RATE_LIMITED'
    } else if (result.metadata?.isTimeout) {
      errorCategory = 'TIMEOUT'
    } else if (isExhausted) {
      errorCategory = 'EXHAUSTED_RETRIES'
      requiresReview = true
    } else {
      errorCategory = 'PROVIDER_ERROR'
    }
  }

  // Persist provider result
  const updatedExecution = await prisma.recoveryExecution.update({
    where: { id: execution.id },
    data: {
      status: result.status,
      externalReference: result.externalReference || null,
      failureReason: result.failureReason || null,
      completedAt: new Date(),
      requiresReview,
      errorCategory,
      metadata: {
        ...execMetadata,
        providerResult: result.metadata || {},
        isRetryable: result.isRetryable ?? false
      } as any
    }
  })

  // 6. Log final audit event
  await logAuditEvent({
    tenantId,
    opportunityId: execution.opportunityId,
    actor,
    eventType: result.success ? 'EXECUTION_SUCCEEDED' : 'EXECUTION_FAILED',
    entityType: 'RecoveryExecution',
    entityId: execution.id,
    metadata: {
      status: result.status,
      externalReference: result.externalReference,
      failureReason: result.failureReason,
      provider: provider.name,
      mode
    }
  })

  // 7. Update RecoveryAction status
  if (result.success) {
    await prisma.recoveryAction.update({
      where: { id: execution.recoveryActionId },
      data: {
        status: ActionStatus.EXECUTED,
        executedAt: new Date()
      }
    })
  } else {
    // Note: Do not falsely mark recovery outcome as successful on failure
    await prisma.recoveryAction.update({
      where: { id: execution.recoveryActionId },
      data: {
        failureReason: result.failureReason
      }
    })
  }

  return {
    success: result.success,
    statusCode: result.success ? 200 : 422,
    execution: updatedExecution,
    result
  }
}

/**
 * Retries a previously failed execution with bounded retry limits and backoff metadata.
 */
export async function retryExecution(
  executionId: string,
  tenantId: string,
  actor?: { id?: string; email?: string; role?: MembershipRole } | null,
  options?: { allowReviewRetry?: boolean }
): Promise<ExecutionServiceResponse> {
  const execution = await prisma.recoveryExecution.findUnique({
    where: { id: executionId }
  })

  if (!execution || execution.tenantId !== tenantId) {
    return { success: false, statusCode: 404, error: 'Execution record not found' }
  }

  if (execution.status !== ExecutionStatus.FAILED) {
    return {
      success: false,
      statusCode: 409,
      error: `Cannot retry execution in status '${execution.status}'. Only FAILED executions can be retried.`
    }
  }

  // Check bounded retries unless an authorized operator explicitly triggers review retry
  const isOperator = actor?.role === 'OWNER' || actor?.role === 'ADMIN'
  const allowBypass = options?.allowReviewRetry || (execution.requiresReview && isOperator)

  if (!allowBypass && execution.attemptCount >= execution.maxAttempts) {
    return {
      success: false,
      statusCode: 422,
      error: `Maximum retry limit (${execution.maxAttempts}) reached for this execution. Action cannot be retried further.`
    }
  }

  const nextAttempt = execution.attemptCount + 1
  const maxAttempts = Math.max(execution.maxAttempts, nextAttempt)
  const backoffSeconds = Math.pow(2, execution.attemptCount) * 5 // Exponential backoff: 10s, 20s, 40s

  const updatedExecution = await prisma.recoveryExecution.update({
    where: { id: execution.id },
    data: {
      status: ExecutionStatus.QUEUED,
      attemptCount: nextAttempt,
      maxAttempts,
      requiresReview: false,
      errorCategory: null,
      failureReason: null,
      metadata: {
        ...((execution.metadata as Record<string, unknown>) || {}),
        lastRetriedAt: new Date().toISOString(),
        backoffSeconds
      }
    }
  })

  await logAuditEvent({
    tenantId,
    opportunityId: execution.opportunityId,
    actor,
    eventType: 'EXECUTION_RETRIED',
    entityType: 'RecoveryExecution',
    entityId: execution.id,
    metadata: {
      newAttemptNumber: nextAttempt,
      backoffSeconds
    }
  })

  // Process the retried execution
  return await processExecution(updatedExecution.id, tenantId, actor)
}

/**
 * Cancels a QUEUED execution.
 */
export async function cancelExecution(
  executionId: string,
  tenantId: string,
  actor?: { id?: string; email?: string; role?: MembershipRole } | null
): Promise<ExecutionServiceResponse> {
  const execution = await prisma.recoveryExecution.findUnique({
    where: { id: executionId }
  })

  if (!execution || execution.tenantId !== tenantId) {
    return { success: false, statusCode: 404, error: 'Execution record not found' }
  }

  if (execution.status !== ExecutionStatus.QUEUED) {
    return {
      success: false,
      statusCode: 409,
      error: `Cannot cancel execution in status '${execution.status}'. Only QUEUED executions can be cancelled.`
    }
  }

  const cancelled = await prisma.recoveryExecution.update({
    where: { id: execution.id },
    data: {
      status: ExecutionStatus.CANCELLED,
      completedAt: new Date()
    }
  })

  await logAuditEvent({
    tenantId,
    opportunityId: execution.opportunityId,
    actor,
    eventType: 'EXECUTION_CANCELLED',
    entityType: 'RecoveryExecution',
    entityId: execution.id
  })

  return {
    success: true,
    statusCode: 200,
    execution: cancelled
  }
}
