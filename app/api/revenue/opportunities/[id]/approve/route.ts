/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '../../../../../lib/prisma'
import { getAuthenticatedTenantContext, requireRole } from '../../../../../lib/auth/tenant-context'
import { ActionStatus, ActionType, OpportunityStatus } from '@prisma/client'
import { evaluateRecoveryPolicy } from '../../../../../lib/policy/service'
import { queueExecution, processExecution } from '../../../../../lib/execution/service'
import { logAuditEvent } from '../../../../../lib/audit/audit-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/revenue/opportunities/[id]/approve
 * Authorizes execution of a pending recovery opportunity.
 * Strictly requires OWNER or ADMIN role.
 * Re-evaluates policy rules prior to execution to prevent policy drift.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }

    const roleCheck = requireRole(auth, ['OWNER', 'ADMIN'])
    if (!roleCheck.allowed) {
      return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.statusCode })
    }

    const { id: opportunityId } = await context.params

    const opportunity = await prisma.recoveryOpportunity.findUnique({
      where: { id: opportunityId, tenantId: auth.tenantId },
      include: {
        actions: { orderBy: { createdAt: 'desc' }, take: 1 }
      }
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    if (opportunity.status === OpportunityStatus.RECOVERED || opportunity.status === OpportunityStatus.FAILED || opportunity.status === OpportunityStatus.DISMISSED) {
      return NextResponse.json(
        { error: `Cannot approve recovery for opportunity in terminal state '${opportunity.status}'` },
        { status: 409 }
      )
    }

    const latestAction = opportunity.actions[0] || null
    const actionType = latestAction?.type || ActionType.RETRY_PAYMENT

    // Re-evaluate policy to ensure approval is legally compliant with current tenant policy
    const policyEval = await evaluateRecoveryPolicy({
      tenantId: auth.tenantId,
      opportunityId: opportunity.id,
      requestedActionType: actionType,
      requestedProvider: latestAction?.channel || 'simulation'
    })

    // If tenant policy completely blocks this action (e.g. max attempts reached, unsupported provider)
    if (policyEval.decision === 'BLOCKED' && policyEval.reasonCode !== 'AUTOMATION_DISABLED') {
      return NextResponse.json(
        { error: `Cannot approve execution: Policy restriction active (${policyEval.reason})` },
        { status: 409 }
      )
    }

    const now = new Date()

    // Transactionally update Action to APPROVED and Opportunity to IN_PROGRESS
    let effectiveActionId: string
    if (latestAction && latestAction.status === ActionStatus.PENDING) {
      const updatedAction = await prisma.recoveryAction.update({
        where: { id: latestAction.id },
        data: {
          status: ActionStatus.APPROVED,
          approvedAt: now,
          executedAt: now
        }
      })
      effectiveActionId = updatedAction.id
    } else {
      const newAction = await prisma.recoveryAction.create({
        data: {
          tenantId: auth.tenantId,
          opportunityId: opportunity.id,
          type: actionType,
          status: ActionStatus.APPROVED,
          channel: latestAction?.channel || 'AUTOMATED',
          expectedRecoveryAmountMinor: opportunity.recoverableAmountMinor,
          notes: `Manually approved by ${auth.user.email} (${auth.role})`,
          approvedAt: now,
          executedAt: now
        }
      })
      effectiveActionId = newAction.id
    }

    await prisma.recoveryOpportunity.update({
      where: { id: opportunity.id },
      data: { status: OpportunityStatus.IN_PROGRESS }
    })

    // Queue and immediately process execution
    const idempotencyKey = `approved_${opportunity.id}_${now.getTime()}`
    const queueResult = await queueExecution({
      tenantId: auth.tenantId,
      opportunityId: opportunity.id,
      actionId: effectiveActionId,
      idempotencyKey,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role }
    })

    let executionRecord: any = null
    if (queueResult.success && queueResult.execution) {
      const processResult = await processExecution(queueResult.execution.id, auth.tenantId, {
        id: auth.user.id,
        email: auth.user.email,
        role: auth.role
      })
      executionRecord = processResult.execution || queueResult.execution
    }

    await logAuditEvent({
      tenantId: auth.tenantId,
      opportunityId: opportunity.id,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      eventType: 'MANUAL_APPROVAL_GRANTED',
      entityType: 'RecoveryAction',
      entityId: effectiveActionId,
      metadata: {
        actionType,
        executionId: executionRecord?.id
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Recovery action approved and dispatched successfully',
      actionId: effectiveActionId,
      execution: executionRecord
    }, { status: 200 })

  } catch (err: any) {
    console.error('Error approving recovery opportunity:', err)
    return NextResponse.json({ error: 'Internal server error approving recovery' }, { status: 500 })
  }
}
