/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from '../prisma'
import { ActionStatus, ActionType, OpportunityStatus } from '@prisma/client'
import { evaluateRecoveryPolicy } from './service'
import { queueExecution, processExecution } from '../execution/service'
import { logAuditEvent } from '../audit/audit-service'
import { generateRecommendation } from '../recovery-agent/engine'

export interface OrchestrationResult {
  opportunityId: string
  decision: 'AUTO_EXECUTE' | 'APPROVAL_REQUIRED' | 'BLOCKED' | 'SKIPPED'
  reasonCode: string
  reason: string
  actionId?: string
  executionId?: string
}

/**
 * Evaluates an opportunity against tenant policy and executes the appropriate workflow:
 * - AUTO_EXECUTE: Creates action, queues execution, runs provider
 * - APPROVAL_REQUIRED: Creates pending action awaiting operator approval
 * - BLOCKED: Leaves opportunity detected and audits restriction reason
 * - SKIPPED: Opportunity is terminal or not eligible
 */
export async function orchestrateOpportunityRecovery(
  tenantId: string,
  opportunityId: string
): Promise<OrchestrationResult> {
  const opportunity = await prisma.recoveryOpportunity.findUnique({
    where: { id: opportunityId, tenantId },
    include: {
      actions: { orderBy: { createdAt: 'desc' }, take: 1 },
      executions: { orderBy: { createdAt: 'desc' }, take: 1 }
    }
  })

  if (!opportunity) {
    return {
      opportunityId,
      decision: 'BLOCKED',
      reasonCode: 'OPPORTUNITY_NOT_ACTIVE',
      reason: 'Opportunity not found'
    }
  }

  // Generate deterministic recommendation if none is stored
  const recommendation = generateRecommendation(opportunity as any)
  const targetActionType = recommendation.recommendedAction as unknown as ActionType

  // 1. Evaluate deterministic policy
  const evaluation = await evaluateRecoveryPolicy({
    tenantId,
    opportunityId: opportunity.id,
    requestedActionType: targetActionType,
    requestedProvider: 'simulation'
  })

  // 2. Branch based on deterministic policy decision
  if (evaluation.decision === 'AUTO_EXECUTE') {
    const now = new Date()

    // Transactionally create approved action and move opportunity to IN_PROGRESS
    const [action, _updatedOpp] = await prisma.$transaction([
      prisma.recoveryAction.create({
        data: {
          tenantId,
          opportunityId: opportunity.id,
          type: targetActionType,
          status: ActionStatus.APPROVED,
          channel: recommendation.suggestedChannel || 'AUTOMATED',
          expectedRecoveryAmountMinor: opportunity.recoverableAmountMinor,
          notes: `Automatic recovery action dispatched via policy '${evaluation.policyName}': ${evaluation.reason}`,
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

    // Queue and immediately process execution with database-level idempotency
    const idempotencyKey = `auto_${opportunity.id}_${now.getTime()}`
    const queueResult = await queueExecution({
      tenantId,
      opportunityId: opportunity.id,
      actionId: action.id,
      idempotencyKey,
      policyVersion: evaluation.policyVersion,
      actor: { email: 'policy_orchestrator@system', role: 'ADMIN' },
      messageSubject: `Recovery Notice: ${opportunity.reason}`
    })

    let executionId: string | undefined
    if (queueResult.success && queueResult.execution) {
      executionId = queueResult.execution.id
      // Process execution through background provider
      await processExecution(queueResult.execution.id, tenantId, { email: 'system_worker', role: 'ADMIN' })
    }

    await logAuditEvent({
      tenantId,
      opportunityId: opportunity.id,
      eventType: 'AUTO_EXECUTION_APPROVED',
      entityType: 'RecoveryExecution',
      entityId: executionId || action.id,
      metadata: {
        policyId: evaluation.policyId,
        policyVersion: evaluation.policyVersion,
        reasonCode: evaluation.reasonCode,
        actionType: targetActionType
      }
    })

    return {
      opportunityId: opportunity.id,
      decision: 'AUTO_EXECUTE',
      reasonCode: evaluation.reasonCode,
      reason: evaluation.reason,
      actionId: action.id,
      executionId
    }

  } else if (evaluation.decision === 'APPROVAL_REQUIRED') {
    // Create an action with PENDING status (awaiting human operator approval)
    const pendingAction = await prisma.recoveryAction.create({
      data: {
        tenantId,
        opportunityId: opportunity.id,
        type: targetActionType,
        status: ActionStatus.PENDING,
        channel: recommendation.suggestedChannel || 'MANUAL',
        expectedRecoveryAmountMinor: opportunity.recoverableAmountMinor,
        notes: `Manual approval required: ${evaluation.reason} (Code: ${evaluation.reasonCode})`,
        recommendationSnapshot: recommendation as any
      }
    })

    await logAuditEvent({
      tenantId,
      opportunityId: opportunity.id,
      eventType: 'APPROVAL_REQUIRED',
      entityType: 'RecoveryAction',
      entityId: pendingAction.id,
      metadata: {
        policyId: evaluation.policyId,
        policyVersion: evaluation.policyVersion,
        reasonCode: evaluation.reasonCode,
        reason: evaluation.reason
      }
    })

    return {
      opportunityId: opportunity.id,
      decision: 'APPROVAL_REQUIRED',
      reasonCode: evaluation.reasonCode,
      reason: evaluation.reason,
      actionId: pendingAction.id
    }

  } else if (evaluation.decision === 'BLOCKED') {
    await logAuditEvent({
      tenantId,
      opportunityId: opportunity.id,
      eventType: 'AUTOMATION_BLOCKED',
      entityType: 'RecoveryOpportunity',
      entityId: opportunity.id,
      metadata: {
        reasonCode: evaluation.reasonCode,
        reason: evaluation.reason,
        cooldownRemainingSeconds: evaluation.cooldownRemainingSeconds
      }
    })

    return {
      opportunityId: opportunity.id,
      decision: 'BLOCKED',
      reasonCode: evaluation.reasonCode,
      reason: evaluation.reason
    }

  } else {
    // SKIPPED
    return {
      opportunityId: opportunity.id,
      decision: 'SKIPPED',
      reasonCode: evaluation.reasonCode,
      reason: evaluation.reason
    }
  }
}
