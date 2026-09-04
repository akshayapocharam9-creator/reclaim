/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from '../prisma'
import { ActionStatus, ActionType, OpportunityStatus, OutcomeType } from '@prisma/client'
import { generateRecommendation } from './engine'
import { logAuditEvent } from '../audit/audit-service'
import { stopActiveCadenceForOpportunity } from '../recovery/dunning-cadence-service'

export interface ExecuteActionResult {
  success: boolean
  error?: string
  statusCode?: number
  action?: any
  opportunity?: any
  isIdempotent?: boolean
}

/**
 * Executes a recovery action on an opportunity.
 * Valid transition: DETECTED -> IN_PROGRESS
 * If already IN_PROGRESS with an existing action, returns the action idempotently.
 */
export async function executeRecoveryAction(params: {
  tenantId: string
  opportunityId: string
  actionType?: ActionType
  channel?: string
  notes?: string
}): Promise<ExecuteActionResult> {
  const { tenantId, opportunityId, notes, channel } = params

  // 1. Fetch opportunity ensuring strict tenant isolation
  const opportunity = await prisma.recoveryOpportunity.findUnique({
    where: { id: opportunityId, tenantId },
    include: { actions: { orderBy: { createdAt: 'desc' }, take: 1 } }
  })

  if (!opportunity) {
    return { success: false, error: 'Opportunity not found', statusCode: 404 }
  }

  // 2. Check for idempotent repeat call: already IN_PROGRESS
  if (opportunity.status === OpportunityStatus.IN_PROGRESS && opportunity.actions.length > 0) {
    const existingAction = opportunity.actions[0]
    return {
      success: true,
      action: existingAction,
      opportunity,
      isIdempotent: true
    }
  }

  // 3. State machine validation: Only DETECTED opportunities can be actioned
  if (opportunity.status !== OpportunityStatus.DETECTED) {
    return {
      success: false,
      error: `Invalid transition: Cannot action opportunity in status '${opportunity.status}'. Only 'DETECTED' opportunities can be actioned.`,
      statusCode: 409
    }
  }

  // 4. Resolve action type from input or fallback to Recovery Agent recommendation
  let resolvedActionType: ActionType
  if (params.actionType) {
    resolvedActionType = params.actionType
  } else {
    const recommendation = generateRecommendation(opportunity)
    resolvedActionType = recommendation.recommendedAction as unknown as ActionType
  }

  const recommendation = generateRecommendation(opportunity)
  const now = new Date()

  // 5. Execute transactional state change: Create RecoveryAction and transition opportunity to IN_PROGRESS
  const [createdAction, updatedOpportunity] = await prisma.$transaction([
    prisma.recoveryAction.create({
      data: {
        tenantId,
        opportunityId: opportunity.id,
        type: resolvedActionType,
        status: ActionStatus.APPROVED,
        channel: channel || recommendation.suggestedChannel,
        expectedRecoveryAmountMinor: opportunity.recoverableAmountMinor,
        notes: notes || `Action initiated via Recovery Agent recommendation: ${recommendation.reason}`,
        recommendationSnapshot: recommendation as any,
        approvedAt: now,
        executedAt: now
      }
    }),
    prisma.recoveryOpportunity.update({
      where: { id: opportunity.id },
      data: {
        status: OpportunityStatus.IN_PROGRESS
      }
    })
  ])

  await logAuditEvent({
    tenantId,
    opportunityId: opportunity.id,
    eventType: 'ACTION_CREATED',
    entityType: 'RecoveryAction',
    entityId: createdAction.id,
    metadata: {
      actionType: resolvedActionType,
      expectedRecoveryAmountMinor: opportunity.recoverableAmountMinor,
      channel: createdAction.channel
    }
  })

  return {
    success: true,
    action: createdAction,
    opportunity: updatedOpportunity
  }
}

/**
 * Dismisses an opportunity.
 * Valid transition: DETECTED -> DISMISSED
 */
export async function dismissOpportunity(params: {
  tenantId: string
  opportunityId: string
  reason?: string
}): Promise<ExecuteActionResult> {
  const { tenantId, opportunityId, reason } = params

  const opportunity = await prisma.recoveryOpportunity.findUnique({
    where: { id: opportunityId, tenantId }
  })

  if (!opportunity) {
    return { success: false, error: 'Opportunity not found', statusCode: 404 }
  }

  // Idempotent check
  if (opportunity.status === OpportunityStatus.DISMISSED) {
    return { success: true, opportunity, isIdempotent: true }
  }

  if (opportunity.status !== OpportunityStatus.DETECTED) {
    return {
      success: false,
      error: `Invalid transition: Cannot dismiss opportunity in status '${opportunity.status}'. Only 'DETECTED' opportunities can be dismissed.`,
      statusCode: 409
    }
  }

  const updatedOpportunity = await prisma.recoveryOpportunity.update({
    where: { id: opportunity.id },
    data: {
      status: OpportunityStatus.DISMISSED,
      resolvedAt: new Date(),
      reason: reason ? `${opportunity.reason} (Dismissed: ${reason})` : opportunity.reason
    }
  })

  // Immediately stop any active dunning cadence for this tenant + opportunity
  await stopActiveCadenceForOpportunity({
    tenantId,
    opportunityId: opportunity.id,
    terminalStatus: OpportunityStatus.DISMISSED
  })

  await logAuditEvent({
    tenantId,
    opportunityId: opportunity.id,
    eventType: 'ACTION_DISMISSED',
    entityType: 'RecoveryOpportunity',
    entityId: opportunity.id,
    metadata: { reason }
  })

  return {
    success: true,
    opportunity: updatedOpportunity
  }
}

/**
 * Marks an in-progress opportunity and action as RECOVERED.
 * Valid transition: IN_PROGRESS -> RECOVERED
 */
export async function markOpportunityRecovered(params: {
  tenantId: string
  opportunityId: string
  recoveredAmountMinor?: number
  notes?: string
}): Promise<ExecuteActionResult> {
  const { tenantId, opportunityId, notes } = params

  const opportunity = await prisma.recoveryOpportunity.findUnique({
    where: { id: opportunityId, tenantId },
    include: { actions: { orderBy: { createdAt: 'desc' }, take: 1 } }
  })

  if (!opportunity) {
    return { success: false, error: 'Opportunity not found', statusCode: 404 }
  }

  if (opportunity.status === OpportunityStatus.RECOVERED) {
    return { success: true, opportunity, isIdempotent: true }
  }

  if (opportunity.status !== OpportunityStatus.IN_PROGRESS) {
    return {
      success: false,
      error: `Invalid transition: Cannot mark as recovered from status '${opportunity.status}'. Only 'IN_PROGRESS' opportunities can be recovered.`,
      statusCode: 409
    }
  }

  const latestAction = opportunity.actions[0]
  const amountMinor = params.recoveredAmountMinor ?? opportunity.recoverableAmountMinor
  const now = new Date()

  const operations: any[] = [
    prisma.recoveryOpportunity.update({
      where: { id: opportunity.id },
      data: {
        status: OpportunityStatus.RECOVERED,
        resolvedAt: now
      }
    }),
    prisma.recoveryOutcome.create({
      data: {
        tenantId,
        opportunityId: opportunity.id,
        actionId: latestAction?.id || null,
        type: OutcomeType.SUCCESS,
        recoveredAmountMinor: amountMinor,
        unrecoveredAmountMinor: Math.max(0, opportunity.amountAtRiskMinor - amountMinor),
        currency: 'INR',
        provider: 'reclaim_agent',
        reason: notes || 'Recovery confirmed manually via dashboard workflow',
        details: { notes: notes || 'Recovery confirmed manually via dashboard workflow' }
      }
    })
  ]

  if (latestAction) {
    operations.push(
      prisma.recoveryAction.update({
        where: { id: latestAction.id },
        data: {
          status: ActionStatus.EXECUTED,
          notes: notes ? `${latestAction.notes || ''} | ${notes}` : latestAction.notes
        }
      })
    )
  }

  const [updatedOpportunity, outcome, updatedAction] = await prisma.$transaction(operations)

  // Immediately stop any active dunning cadence for this tenant + opportunity
  await stopActiveCadenceForOpportunity({
    tenantId,
    opportunityId: opportunity.id,
    terminalStatus: OpportunityStatus.RECOVERED
  })

  await logAuditEvent({
    tenantId,
    opportunityId: opportunity.id,
    eventType: 'RECOVERY_CONFIRMED',
    entityType: 'RecoveryOutcome',
    entityId: outcome.id,
    metadata: {
      recoveredAmountMinor: amountMinor,
      actionId: latestAction?.id || null
    }
  })

  return {
    success: true,
    opportunity: updatedOpportunity,
    action: updatedAction || latestAction
  }
}

/**
 * Marks an in-progress opportunity and action as FAILED.
 * Valid transition: IN_PROGRESS -> FAILED
 */
export async function markOpportunityFailed(params: {
  tenantId: string
  opportunityId: string
  failureReason?: string
}): Promise<ExecuteActionResult> {
  const { tenantId, opportunityId, failureReason } = params

  const opportunity = await prisma.recoveryOpportunity.findUnique({
    where: { id: opportunityId, tenantId },
    include: { actions: { orderBy: { createdAt: 'desc' }, take: 1 } }
  })

  if (!opportunity) {
    return { success: false, error: 'Opportunity not found', statusCode: 404 }
  }

  if (opportunity.status === OpportunityStatus.FAILED) {
    return { success: true, opportunity, isIdempotent: true }
  }

  if (opportunity.status !== OpportunityStatus.IN_PROGRESS) {
    return {
      success: false,
      error: `Invalid transition: Cannot mark as failed from status '${opportunity.status}'. Only 'IN_PROGRESS' opportunities can be marked failed.`,
      statusCode: 409
    }
  }

  const latestAction = opportunity.actions[0]
  const reason = failureReason || 'Recovery attempt unsuccessful'
  const now = new Date()

  const operations: any[] = [
    prisma.recoveryOpportunity.update({
      where: { id: opportunity.id },
      data: {
        status: OpportunityStatus.FAILED,
        resolvedAt: now
      }
    }),
    prisma.recoveryOutcome.create({
      data: {
        tenantId,
        opportunityId: opportunity.id,
        actionId: latestAction?.id || null,
        type: OutcomeType.FAILURE,
        recoveredAmountMinor: 0,
        unrecoveredAmountMinor: opportunity.amountAtRiskMinor,
        currency: 'INR',
        provider: 'reclaim_agent',
        reason,
        details: { failureReason: reason }
      }
    })
  ]

  if (latestAction) {
    operations.push(
      prisma.recoveryAction.update({
        where: { id: latestAction.id },
        data: {
          status: ActionStatus.FAILED,
          failureReason: reason
        }
      })
    )
  }

  const [updatedOpportunity, _createdOutcome, updatedAction] = await prisma.$transaction(operations)

  // Immediately stop any active dunning cadence for this tenant + opportunity
  await stopActiveCadenceForOpportunity({
    tenantId,
    opportunityId: opportunity.id,
    terminalStatus: OpportunityStatus.FAILED
  })

  await logAuditEvent({
    tenantId,
    opportunityId: opportunity.id,
    eventType: 'RECOVERY_FAILED',
    entityType: 'RecoveryOpportunity',
    entityId: opportunity.id,
    metadata: {
      failureReason: reason,
      actionId: latestAction?.id || null
    }
  })

  return {
    success: true,
    opportunity: updatedOpportunity,
    action: updatedAction || latestAction
  }
}

/**
 * Retrieves the current action state and history for an opportunity.
 */
export async function getOpportunityActionState(params: {
  tenantId: string
  opportunityId: string
}) {
  const { tenantId, opportunityId } = params

  const opportunity = await prisma.recoveryOpportunity.findUnique({
    where: { id: opportunityId, tenantId },
    include: {
      actions: {
        orderBy: { createdAt: 'desc' }
      },
      outcomes: {
        orderBy: { occurredAt: 'desc' }
      },
      executions: {
        orderBy: { createdAt: 'desc' }
      },
      dunningCadence: true,
      recoveryTokens: {
        where: {
          revokedAt: null,
          consumedAt: null,
          expiresAt: { gt: new Date() }
        },
        select: {
          id: true,
          expiresAt: true,
          purpose: true
        }
      }
    }
  })

  if (!opportunity) {
    return null
  }

  const isTerminal =
    opportunity.status === OpportunityStatus.RECOVERED ||
    opportunity.status === OpportunityStatus.FAILED ||
    opportunity.status === OpportunityStatus.DISMISSED

  return {
    opportunityId: opportunity.id,
    opportunityStatus: opportunity.status,
    amountAtRiskMinor: opportunity.amountAtRiskMinor,
    recoverableAmountMinor: opportunity.recoverableAmountMinor,
    latestAction: opportunity.actions[0] || null,
    latestExecution: opportunity.executions[0] || null,
    actionsCount: opportunity.actions.length,
    actions: opportunity.actions,
    outcomes: opportunity.outcomes,
    executions: opportunity.executions,
    dunningCadence: opportunity.dunningCadence || null,
    hasActivePortal: !isTerminal && opportunity.recoveryTokens.length > 0,
    activeTokenExpiry: !isTerminal ? (opportunity.recoveryTokens[0]?.expiresAt || null) : null
  }
}
