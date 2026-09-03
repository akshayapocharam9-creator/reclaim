/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '../../../../../lib/prisma'
import { getAuthenticatedTenantContext } from '../../../../../lib/auth/tenant-context'

interface RouteContext {
  params: Promise<{ id: string }>
}

export interface TimelineEvent {
  id: string
  stage: string
  title: string
  description: string
  timestamp: string
  status?: string
  actor?: string | null
  metadata?: Record<string, unknown>
}

/**
 * GET /api/revenue/opportunities/[id]/timeline
 * Generates an end-to-end chronological timeline of all revenue, intelligence,
 * action, execution, and outcome events for an opportunity.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }

    const { id: opportunityId } = await context.params

    const opportunity = await prisma.recoveryOpportunity.findUnique({
      where: { id: opportunityId, tenantId: auth.tenantId },
      include: {
        customer: true,
        order: true,
        payment: { include: { attempts: true } },
        checkoutSession: true,
        subscription: true,
        actions: { orderBy: { createdAt: 'asc' } },
        executions: { orderBy: { createdAt: 'asc' } },
        outcomes: { orderBy: { occurredAt: 'asc' } },
        auditEvents: { orderBy: { timestamp: 'asc' } }
      }
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    const timeline: TimelineEvent[] = []

    // 1. Ingestion / Revenue Event
    if (opportunity.payment) {
      timeline.push({
        id: `pay_${opportunity.payment.id}`,
        stage: 'REVENUE_EVENT',
        title: 'Payment Recorded',
        description: `Payment ${opportunity.payment.providerPaymentId || opportunity.payment.id} received with status ${opportunity.payment.status}. Amount: INR ${(opportunity.payment.amountMinor / 100).toFixed(2)}`,
        timestamp: opportunity.payment.createdAt.toISOString(),
        status: opportunity.payment.status
      })

      for (const attempt of opportunity.payment.attempts) {
        timeline.push({
          id: `att_${attempt.id}`,
          stage: 'PAYMENT_ATTEMPT',
          title: `Gateway Attempt #${attempt.attemptNumber}`,
          description: `Gateway returned status ${attempt.status}. ${attempt.failureReason ? `Reason: ${attempt.failureReason}` : ''}`,
          timestamp: attempt.attemptedAt.toISOString(),
          status: attempt.status,
          metadata: { failureCode: attempt.failureCode }
        })
      }
    } else if (opportunity.subscription) {
      timeline.push({
        id: `sub_${opportunity.subscription.id}`,
        stage: 'REVENUE_EVENT',
        title: 'Subscription Event',
        description: `Subscription ${opportunity.subscription.planName} recorded with status ${opportunity.subscription.status}.`,
        timestamp: opportunity.subscription.createdAt.toISOString(),
        status: opportunity.subscription.status
      })
    } else if (opportunity.checkoutSession) {
      timeline.push({
        id: `chk_${opportunity.checkoutSession.id}`,
        stage: 'REVENUE_EVENT',
        title: 'Checkout Session',
        description: `Checkout session recorded with status ${opportunity.checkoutSession.status}.`,
        timestamp: opportunity.checkoutSession.createdAt.toISOString(),
        status: opportunity.checkoutSession.status
      })
    }

    // 2. Leak Detection
    timeline.push({
      id: `opp_det_${opportunity.id}`,
      stage: 'LEAK_DETECTION',
      title: 'Revenue Leak Detected',
      description: `Leak engine flagged ${opportunity.type.replace(/_/g, ' ')}. Estimated recoverable: INR ${(opportunity.recoverableAmountMinor / 100).toFixed(2)}. ${opportunity.reason}`,
      timestamp: opportunity.detectedAt.toISOString(),
      status: opportunity.status,
      metadata: { priority: opportunity.priority, score: opportunity.score }
    })

    // 3. Recommendation Snapshot
    if (opportunity.recommendation) {
      const rec = opportunity.recommendation as Record<string, any>
      timeline.push({
        id: `rec_${opportunity.id}`,
        stage: 'RECOMMENDATION',
        title: 'Deterministic Recommendation Generated',
        description: rec.reason || 'Deterministic recommendation synthesized by Recovery Agent.',
        timestamp: (rec.generatedAt ? new Date(rec.generatedAt) : opportunity.createdAt).toISOString(),
        metadata: { recommendedAction: rec.recommendedAction, suggestedChannel: rec.suggestedChannel }
      })
    }

    // 4. Actions
    for (const action of opportunity.actions) {
      timeline.push({
        id: `act_${action.id}`,
        stage: 'ACTION_AUTHORIZED',
        title: `Recovery Action: ${action.type.replace(/_/g, ' ')}`,
        description: action.notes || `Action authorized on channel ${action.channel || 'AUTOMATED'}. Status: ${action.status}`,
        timestamp: (action.approvedAt || action.createdAt).toISOString(),
        status: action.status,
        metadata: { channel: action.channel }
      })
    }

    // 5. Executions
    for (const exec of opportunity.executions) {
      timeline.push({
        id: `exec_start_${exec.id}`,
        stage: 'EXECUTION_DISPATCH',
        title: `Execution Dispatched (${exec.provider})`,
        description: `Attempt ${exec.attemptCount} of ${exec.maxAttempts} queued with idempotency key ${exec.idempotencyKey}.`,
        timestamp: (exec.startedAt || exec.createdAt).toISOString(),
        status: 'RUNNING',
        metadata: { provider: exec.provider, idempotencyKey: exec.idempotencyKey }
      })

      if (exec.completedAt) {
        timeline.push({
          id: `exec_done_${exec.id}`,
          stage: 'EXECUTION_RESULT',
          title: `Execution ${exec.status}`,
          description: exec.status === 'SUCCEEDED'
            ? `Provider returned success. External reference: ${exec.externalReference || 'N/A'}`
            : `Provider execution failed. Reason: ${exec.failureReason || 'Unknown failure'}`,
          timestamp: exec.completedAt.toISOString(),
          status: exec.status,
          metadata: { externalReference: exec.externalReference, failureReason: exec.failureReason }
        })
      }
    }

    // 6. Outcomes
    for (const outcome of opportunity.outcomes) {
      timeline.push({
        id: `out_${outcome.id}`,
        stage: 'OUTCOME_RECONCILED',
        title: `Recovery Outcome: ${outcome.type}`,
        description: outcome.type === 'SUCCESS'
          ? `Recovered INR ${(outcome.recoveredAmountMinor / 100).toFixed(2)}. ${outcome.reason || ''}`
          : `Recovery unresolved. ${outcome.reason || ''}`,
        timestamp: outcome.occurredAt.toISOString(),
        status: outcome.type,
        metadata: {
          recoveredAmountMinor: outcome.recoveredAmountMinor,
          unrecoveredAmountMinor: outcome.unrecoveredAmountMinor,
          provider: outcome.provider
        }
      })
    }

    // Sort all timeline events chronologically
    timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    return NextResponse.json({
      opportunityId: opportunity.id,
      customerName: opportunity.customer?.name || 'Customer',
      timelineCount: timeline.length,
      timeline
    }, { status: 200 })
  } catch (err: any) {
    console.error('Error generating opportunity timeline:', err)
    return NextResponse.json({ error: 'Internal server error generating timeline' }, { status: 500 })
  }
}
