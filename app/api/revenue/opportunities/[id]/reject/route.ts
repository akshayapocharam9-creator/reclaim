/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '../../../../../lib/prisma'
import { getAuthenticatedTenantContext, requireRole } from '../../../../../lib/auth/tenant-context'
import { ActionStatus } from '@prisma/client'
import { logAuditEvent } from '../../../../../lib/audit/audit-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/revenue/opportunities/[id]/reject
 * Rejects a pending recovery action for an opportunity.
 * Strictly requires OWNER or ADMIN role.
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

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      // Reason is optional
    }
    const reason = body.reason || 'Action rejected by operator'

    const opportunity = await prisma.recoveryOpportunity.findUnique({
      where: { id: opportunityId, tenantId: auth.tenantId },
      include: {
        actions: { where: { status: ActionStatus.PENDING }, take: 1 }
      }
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    const pendingAction = opportunity.actions[0]
    if (!pendingAction) {
      return NextResponse.json({ error: 'No pending approval action found for this opportunity' }, { status: 404 })
    }

    const updatedAction = await prisma.recoveryAction.update({
      where: { id: pendingAction.id },
      data: {
        status: ActionStatus.CANCELED,
        failureReason: reason
      }
    })

    await logAuditEvent({
      tenantId: auth.tenantId,
      opportunityId: opportunity.id,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      eventType: 'MANUAL_APPROVAL_REJECTED',
      entityType: 'RecoveryAction',
      entityId: updatedAction.id,
      metadata: { reason }
    })

    return NextResponse.json({
      success: true,
      message: 'Recovery action successfully rejected',
      actionId: updatedAction.id
    }, { status: 200 })

  } catch (err: any) {
    console.error('Error rejecting recovery opportunity:', err)
    return NextResponse.json({ error: 'Internal server error rejecting recovery' }, { status: 500 })
  }
}
