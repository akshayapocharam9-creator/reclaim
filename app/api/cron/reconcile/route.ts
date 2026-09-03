import { NextRequest, NextResponse } from 'next/server'
import prisma from '../../../lib/prisma'
import { getAuthenticatedTenantContext } from '../../../lib/auth/tenant-context'
import { StructuredLogger } from '../../../lib/observability/logger'
import { logAuditEvent } from '../../../lib/audit/audit-service'

/**
 * Scheduled Reconciliation Endpoint: GET /api/cron/reconcile & POST /api/cron/reconcile
 * Scans for uncertain payment states, unmatched webhooks, and executions requiring operator review.
 * Protected by CRON_SECRET or authenticated ADMIN/OWNER session.
 */
async function handleReconciliationRun(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  let authorized = false
  let tenantIdFilter: string | undefined

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    authorized = true
    const auth = await getAuthenticatedTenantContext(request)
    if (auth.success && (auth.role === 'OWNER' || auth.role === 'ADMIN')) {
      authorized = true
      tenantIdFilter = auth.tenantId
    } else if (process.env.NODE_ENV !== 'production' && !cronSecret) {
      authorized = true
    }
  }

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized reconciliation invocation' }, { status: 401 })
  }

  // 1. Identify executions that exhausted bounded retries and mark for review
  const exhaustedExecutions = await prisma.recoveryExecution.findMany({
    where: {
      status: 'FAILED',
      requiresReview: false,
      attemptCount: { gte: prisma.recoveryExecution.fields.maxAttempts },
      ...(tenantIdFilter ? { tenantId: tenantIdFilter } : {})
    },
    take: 50
  })

  let markedForReviewCount = 0
  for (const exec of exhaustedExecutions) {
    await prisma.recoveryExecution.update({
      where: { id: exec.id },
      data: {
        requiresReview: true,
        errorCategory: exec.errorCategory || 'EXHAUSTED_RETRIES'
      }
    })

    await logAuditEvent({
      tenantId: exec.tenantId,
      opportunityId: exec.opportunityId,
      eventType: 'RECOVERY_REQUIRES_REVIEW',
      entityType: 'RecoveryExecution',
      entityId: exec.id,
      metadata: {
        reason: 'Execution exhausted maximum retry attempts without success',
        attemptCount: exec.attemptCount
      }
    })

    markedForReviewCount++
  }

  // 2. Count active review items
  const pendingReviewCount = await prisma.recoveryExecution.count({
    where: {
      requiresReview: true,
      ...(tenantIdFilter ? { tenantId: tenantIdFilter } : {})
    }
  })

  // 3. Scan for recent successful payment webhook events without reconciled outcomes
  const unreconciledWebhooks = await prisma.webhookEvent.findMany({
    where: {
      eventType: { in: ['payment.captured', 'order.paid'] },
      outcomes: { none: {} },
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // past 7 days
      ...(tenantIdFilter ? { tenantId: tenantIdFilter } : {})
    },
    take: 20
  })

  StructuredLogger.info('RECOVERY_RECONCILED', {
    tenantId: tenantIdFilter,
    provider: 'SYSTEM_RECONCILER'
  }, {
    markedForReviewCount,
    pendingReviewCount,
    unreconciledWebhooksCount: unreconciledWebhooks.length
  })

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    markedForReviewCount,
    totalPendingReviewCount: pendingReviewCount,
    unreconciledWebhooksCount: unreconciledWebhooks.length,
    unreconciledWebhooks: unreconciledWebhooks.map(w => ({
      id: w.id,
      tenantId: w.tenantId,
      eventType: w.eventType,
      createdAt: w.createdAt
    }))
  }, { status: 200 })
}

export async function GET(request: NextRequest) {
  return handleReconciliationRun(request)
}

export async function POST(request: NextRequest) {
  return handleReconciliationRun(request)
}
