import { NextRequest, NextResponse } from 'next/server'
import prisma from '../../../../lib/prisma'
import { getAuthenticatedTenantContext } from '../../../../lib/auth/tenant-context'

/**
 * GET /api/revenue/executions/dead-letter
 * Lists executions in the Dead Letter / Review Queue (where requiresReview = true).
 * Strictly isolated to the authenticated session tenant.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedTenantContext(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
  }

  const { tenantId } = auth

  const deadLetterExecutions = await prisma.recoveryExecution.findMany({
    where: {
      tenantId,
      requiresReview: true
    },
    include: {
      opportunity: {
        include: {
          customer: true
        }
      },
      recoveryAction: true
    },
    orderBy: { updatedAt: 'desc' },
    take: 50
  })

  return NextResponse.json({
    count: deadLetterExecutions.length,
    items: deadLetterExecutions.map(exec => ({
      id: exec.id,
      opportunityId: exec.opportunityId,
      actionType: exec.actionType,
      provider: exec.provider,
      status: exec.status,
      attemptCount: exec.attemptCount,
      maxAttempts: exec.maxAttempts,
      errorCategory: exec.errorCategory || 'UNKNOWN',
      failureReason: exec.failureReason,
      requiresReview: exec.requiresReview,
      policyVersion: exec.policyVersion,
      createdAt: exec.createdAt,
      updatedAt: exec.updatedAt,
      customer: exec.opportunity.customer ? {
        name: exec.opportunity.customer.name,
        email: exec.opportunity.customer.email
      } : null,
      amountMinor: exec.opportunity.amountAtRiskMinor,
      priority: exec.opportunity.priority
    }))
  }, { status: 200 })
}
