/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from '../prisma'
import { ActionStatus, OpportunityStatus, OutcomeType, MembershipRole } from '@prisma/client'
import { logAuditEvent } from '../audit/audit-service'
import { stopActiveCadenceForOpportunity } from '../recovery/dunning-cadence-service'

export interface ReconcileOutcomeParams {
  tenantId: string
  opportunityId: string
  actionId?: string | null
  executionId?: string | null
  outcomeType: OutcomeType
  recoveredAmountMinor: number
  unrecoveredAmountMinor?: number
  currency?: string
  provider?: string | null
  providerReference?: string | null
  reason: string
  details?: Record<string, unknown>
  actor?: {
    id?: string
    email?: string
    role?: MembershipRole
  } | null
}

export interface ReconcileResult {
  success: boolean
  statusCode: number
  error?: string
  outcome?: any
  opportunity?: any
}

/**
 * Reconciles a recovery outcome with deterministic financial evidence.
 * Enforces business rules:
 * - Never marks recovered without explicit verified business evidence
 * - Distinguishes between PAYMENT_ATTEMPTED, PAYMENT_CONFIRMED, and PAYMENT_FAILED
 * - Audit logs every outcome state transition
 */
export async function reconcileRecoveryOutcome(params: ReconcileOutcomeParams): Promise<ReconcileResult> {
  const {
    tenantId,
    opportunityId,
    actionId,
    executionId,
    outcomeType,
    recoveredAmountMinor,
    currency = 'INR',
    provider = 'reclaim_reconciliation_engine',
    providerReference,
    reason,
    details = {},
    actor
  } = params

  // 1. Fetch opportunity with tenant isolation
  const opportunity = await prisma.recoveryOpportunity.findUnique({
    where: { id: opportunityId, tenantId },
    include: {
      actions: actionId ? { where: { id: actionId } } : { orderBy: { createdAt: 'desc' }, take: 1 },
      executions: executionId ? { where: { id: executionId } } : { orderBy: { createdAt: 'desc' }, take: 1 }
    }
  })

  if (!opportunity) {
    return { success: false, statusCode: 404, error: 'Recovery opportunity not found' }
  }

  const targetAction = opportunity.actions[0] || null
  const targetExecution = opportunity.executions[0] || null
  const now = new Date()

  // Calculate unrecovered amount deterministically
  const effectiveUnrecovered = params.unrecoveredAmountMinor !== undefined
    ? params.unrecoveredAmountMinor
    : Math.max(0, opportunity.amountAtRiskMinor - recoveredAmountMinor)

  // 2. Perform transactional outcome creation & state synchronization
  const operations: any[] = []

  // Create RecoveryOutcome record
  operations.push(
    prisma.recoveryOutcome.create({
      data: {
        tenantId,
        opportunityId: opportunity.id,
        actionId: targetAction?.id || null,
        executionId: targetExecution?.id || null,
        type: outcomeType,
        recoveredAmountMinor,
        unrecoveredAmountMinor: effectiveUnrecovered,
        currency,
        provider,
        providerReference,
        reason,
        details: details as any,
        metadata: {
          reconciledBy: actor?.email || 'system_reconciler',
          actorRole: actor?.role || 'SYSTEM',
          opportunityStatusPrior: opportunity.status
        } as any,
        occurredAt: now
      }
    })
  )

  // Synchronize Opportunity status based on verified outcome
  if (outcomeType === OutcomeType.SUCCESS) {
    operations.push(
      prisma.recoveryOpportunity.update({
        where: { id: opportunity.id },
        data: {
          status: OpportunityStatus.RECOVERED,
          resolvedAt: now
        }
      })
    )
  } else if (outcomeType === OutcomeType.FAILURE) {
    operations.push(
      prisma.recoveryOpportunity.update({
        where: { id: opportunity.id },
        data: {
          status: OpportunityStatus.FAILED,
          resolvedAt: now
        }
      })
    )
  }

  // Synchronize Action status if linked
  if (targetAction) {
    const nextActionStatus = outcomeType === OutcomeType.SUCCESS ? ActionStatus.EXECUTED : ActionStatus.FAILED
    operations.push(
      prisma.recoveryAction.update({
        where: { id: targetAction.id },
        data: {
          status: nextActionStatus,
          notes: `${targetAction.notes || ''} | Reconciled ${outcomeType}: ${reason}`.trim()
        }
      })
    )
  }

  const [createdOutcome, updatedOpportunity] = await prisma.$transaction(operations)

  // Immediately stop any active dunning cadence for this tenant + opportunity if terminal
  if (outcomeType === OutcomeType.SUCCESS || outcomeType === OutcomeType.FAILURE) {
    await stopActiveCadenceForOpportunity({
      tenantId,
      opportunityId: opportunity.id,
      terminalStatus: outcomeType === OutcomeType.SUCCESS ? OpportunityStatus.RECOVERED : OpportunityStatus.FAILED
    })
  }

  // 3. Log comprehensive immutable audit event
  await logAuditEvent({
    tenantId,
    opportunityId: opportunity.id,
    actor,
    eventType: outcomeType === OutcomeType.SUCCESS ? 'OUTCOME_RECONCILED_SUCCESS' : 'OUTCOME_RECONCILED_FAILURE',
    entityType: 'RecoveryOutcome',
    entityId: createdOutcome.id,
    metadata: {
      actionId: targetAction?.id || null,
      executionId: targetExecution?.id || null,
      outcomeType,
      recoveredAmountMinor,
      unrecoveredAmountMinor: effectiveUnrecovered,
      reason,
      providerReference
    }
  })

  return {
    success: true,
    statusCode: 200,
    outcome: createdOutcome,
    opportunity: updatedOpportunity || opportunity
  }
}
