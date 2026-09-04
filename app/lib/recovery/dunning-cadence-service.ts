/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from '../prisma'
import { Prisma, CadenceStatus, OpportunityStatus, ActionType, ActionStatus, ExecutionStatus, MembershipRole } from '@prisma/client'
import { logAuditEvent } from '../audit/audit-service'
import { createRecoveryToken } from './token-service'

export interface ScheduleCadenceResult {
  success: boolean
  cadenceId?: string
  error?: string
}

export interface AdvanceCadenceResult {
  success: boolean
  cadenceId: string
  newStatus: CadenceStatus
  nextScheduledAt?: string
  executionId?: string
  error?: string
}

/**
 * Initiates the dunning cadence engine for a given opportunity.
 * Ensures only one active cadence exists per opportunity.
 */
export async function scheduleDunningCadence(
  tenantId: string,
  opportunityId: string,
  actor?: { id?: string; email?: string; role?: MembershipRole }
): Promise<ScheduleCadenceResult> {
  const opportunity = await prisma.recoveryOpportunity.findUnique({
    where: { id: opportunityId }
  })

  if (!opportunity || opportunity.tenantId !== tenantId) {
    return { success: false, error: 'Opportunity not found' }
  }

  // Prevent scheduling on terminal states
  if (
    opportunity.status === OpportunityStatus.RECOVERED ||
    opportunity.status === OpportunityStatus.FAILED ||
    opportunity.status === OpportunityStatus.DISMISSED
  ) {
    return { success: false, error: `Cannot schedule cadence for opportunity in ${opportunity.status} state` }
  }

  const existing = await prisma.dunningCadence.findUnique({
    where: { opportunityId }
  })

  if (existing) {
    return { success: false, error: 'Cadence already exists for this opportunity' }
  }

  // Schedule Step 1 (Day 1) immediately for testing/execution purposes
  const scheduledAt = new Date()

  const cadence = await prisma.dunningCadence.create({
    data: {
      tenantId,
      opportunityId,
      currentStep: 1,
      status: CadenceStatus.SCHEDULED,
      channel: 'EMAIL',
      scheduledAt,
      idempotencyKey: `cadence_init_${opportunityId}`
    }
  })

  await logAuditEvent({
    tenantId,
    opportunityId,
    actor,
    eventType: 'DUNNING_SCHEDULED',
    entityType: 'DunningCadence',
    entityId: cadence.id,
    metadata: { step: 1, scheduledAt: scheduledAt.toISOString() }
  })

  return { success: true, cadenceId: cadence.id }
}

/**
 * Advances a specific dunning cadence by dispatching the current step's notification
 * and scheduling the next step if applicable.
 */
export async function advanceDunningCadence(
  cadenceId: string,
  actor?: { email?: string }
): Promise<AdvanceCadenceResult> {
  const cadence = await prisma.dunningCadence.findUnique({
    where: { id: cadenceId },
    include: { opportunity: { include: { customer: true } } }
  })

  if (!cadence) {
    return { success: false, cadenceId, newStatus: CadenceStatus.FAILED, error: 'Cadence not found' }
  }

  if (cadence.status !== CadenceStatus.SCHEDULED) {
    return { success: false, cadenceId, newStatus: cadence.status, error: `Cadence is not in SCHEDULED state (${cadence.status})` }
  }

  const opp = cadence.opportunity

  // 1. Check if opportunity resolved externally
  if (
    opp.status === OpportunityStatus.RECOVERED ||
    opp.status === OpportunityStatus.FAILED ||
    opp.status === OpportunityStatus.DISMISSED
  ) {
    const newStatus = CadenceStatus.COMPLETED
    await prisma.dunningCadence.update({
      where: { id: cadence.id },
      data: { status: newStatus, completedAt: new Date(), metadata: { reason: `Opportunity reached terminal state: ${opp.status}` } }
    })
    return { success: true, cadenceId, newStatus }
  }

  // 2. Generate a fresh recovery token for this step
  // Day 1 token expires in 2 days, Day 3 expires in 4 days, Day 7 expires in 7 days
  const expiryDays = cadence.currentStep === 1 ? 2 : cadence.currentStep === 2 ? 4 : 7
  const tokenResult = await createRecoveryToken({
    tenantId: cadence.tenantId,
    opportunityId: opp.id,
    purpose: `DUNNING_STEP_${cadence.currentStep}`,
    expiresInSeconds: expiryDays * 24 * 3600
  })

  // 3. Create Action & Execution
  const actionId = `action_${Date.now()}_${cadence.id}`
  
  const action = await prisma.recoveryAction.create({
    data: {
      tenantId: cadence.tenantId,
      opportunityId: opp.id,
      type: ActionType.CONTACT_CUSTOMER,
      status: ActionStatus.APPROVED,
      channel: cadence.channel,
      expectedRecoveryAmountMinor: opp.amountAtRiskMinor,
      notes: `Automated Dunning Step ${cadence.currentStep}`,
      payload: {
        step: cadence.currentStep,
        recoveryUrl: tokenResult.recoveryUrl,
        customerEmail: opp.customer?.email,
        customerName: opp.customer?.name
      }
    }
  })

  const execution = await prisma.recoveryExecution.create({
    data: {
      tenantId: cadence.tenantId,
      opportunityId: opp.id,
      recoveryActionId: action.id,
      actionType: ActionType.CONTACT_CUSTOMER,
      provider: 'EmailExecutionProvider',
      status: ExecutionStatus.QUEUED,
      idempotencyKey: `exec_cadence_${cadence.id}_step_${cadence.currentStep}`,
      maxAttempts: 3,
      metadata: {
        messageSubject: `Action Required: Payment Failure (Attempt ${cadence.currentStep})`,
        recoveryUrl: tokenResult.recoveryUrl
      }
    }
  })

  // 4. Update Cadence state
  let newStatus: CadenceStatus = CadenceStatus.SCHEDULED
  let nextScheduledAt: Date | undefined

  if (cadence.currentStep >= 3) {
    newStatus = CadenceStatus.COMPLETED
  } else {
    // Schedule next step
    nextScheduledAt = new Date()
    if (cadence.currentStep === 1) {
      nextScheduledAt.setDate(nextScheduledAt.getDate() + 2) // Step 2 (Day 3) is 2 days after Step 1
    } else if (cadence.currentStep === 2) {
      nextScheduledAt.setDate(nextScheduledAt.getDate() + 4) // Step 3 (Day 7) is 4 days after Step 2
    }
  }

  const updatedCadence = await prisma.dunningCadence.update({
    where: { id: cadence.id },
    data: {
      currentStep: newStatus === CadenceStatus.COMPLETED ? cadence.currentStep : cadence.currentStep + 1,
      status: newStatus,
      scheduledAt: nextScheduledAt || cadence.scheduledAt,
      attemptedAt: new Date(),
      completedAt: newStatus === CadenceStatus.COMPLETED ? new Date() : null,
      recoveryTokenId: tokenResult.tokenRecord.id
    }
  })

  await logAuditEvent({
    tenantId: cadence.tenantId,
    opportunityId: opp.id,
    actor: actor ? { email: actor.email } : undefined,
    eventType: 'NOTIFICATION_SENT',
    entityType: 'DunningCadence',
    entityId: cadence.id,
    metadata: { step: cadence.currentStep, channel: cadence.channel, executionId: execution.id }
  })

  return {
    success: true,
    cadenceId: cadence.id,
    newStatus: updatedCadence.status,
    nextScheduledAt: nextScheduledAt?.toISOString(),
    executionId: execution.id
  }
}

/**
 * Fetches and processes all due cadences across the system (or specific tenant).
 * To be called by the background worker.
 */
export async function processDueCadences(tenantIdFilter?: string): Promise<{
  processed: number,
  failed: number
}> {
  const now = new Date()
  const whereClause: Record<string, unknown> = {
    status: CadenceStatus.SCHEDULED,
    scheduledAt: { lte: now }
  }

  if (tenantIdFilter) {
    whereClause.tenantId = tenantIdFilter
  }

  const dueCadences = await prisma.dunningCadence.findMany({
    where: whereClause,
    take: 50,
    orderBy: { scheduledAt: 'asc' }
  })

  let processed = 0
  let failed = 0

  for (const cadence of dueCadences) {
    try {
      const result = await advanceDunningCadence(cadence.id, { email: 'system_worker' })
      if (result.success) {
        processed++
      } else {
        failed++
      }
    } catch (err) {
      console.error(`Failed to advance cadence ${cadence.id}:`, err)
      failed++
    }
  }

  return { processed, failed }
}

/**
 * Stops and marks COMPLETED any active/scheduled dunning cadence for an opportunity
 * when it reaches a terminal status (RECOVERED, FAILED, DISMISSED).
 * Supports optional Prisma transaction client for atomic state transitions.
 */
export async function stopActiveCadenceForOpportunity(params: {
  tenantId: string
  opportunityId: string
  terminalStatus: OpportunityStatus
  tx?: Prisma.TransactionClient | typeof prisma
}): Promise<void> {
  const { tenantId, opportunityId, terminalStatus, tx } = params
  const client = (tx || prisma) as any
  const now = new Date()

  // Find active scheduled or processing cadence for this tenant + opportunity
  const activeCadence = await client.dunningCadence.findFirst({
    where: {
      tenantId,
      opportunityId,
      status: { in: [CadenceStatus.SCHEDULED, CadenceStatus.PROCESSING] }
    }
  })

  if (!activeCadence) {
    return
  }

  const existingMeta = typeof activeCadence.metadata === 'object' && activeCadence.metadata !== null
    ? (activeCadence.metadata as Record<string, unknown>)
    : {}

  await client.dunningCadence.update({
    where: { id: activeCadence.id },
    data: {
      status: CadenceStatus.COMPLETED,
      completedAt: now,
      metadata: {
        ...existingMeta,
        stoppedReason: `Opportunity reached terminal state: ${terminalStatus}`,
        terminalStatus,
        stoppedAt: now.toISOString()
      }
    }
  })
}
