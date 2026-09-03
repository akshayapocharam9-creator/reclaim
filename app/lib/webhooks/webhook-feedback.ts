/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from '../prisma'
import { OpportunityStatus, OutcomeType } from '@prisma/client'
import { reconcileRecoveryOutcome } from '../execution/outcome-reconciler'
import { logAuditEvent } from '../audit/audit-service'

export interface WebhookFeedbackParams {
  tenantId: string
  eventType: string
  webhookEventId?: string
  payload?: any
  providerPaymentId?: string
  providerOrderId?: string
  providerSubscriptionId?: string
  amountMinor?: number
  currency?: string
}

export interface WebhookFeedbackResult {
  matched: boolean
  ambiguous: boolean
  reconciled: boolean
  opportunityId?: string
  executionId?: string
  outcomeId?: string
  reason?: string
}

/**
 * Reconciles incoming webhook payment confirmation or failure events
 * with existing in-flight RecoveryExecutions and RecoveryOpportunities.
 *
 * Enforces:
 * - Deterministic correlation: payment ID, order ID, subscription ID, correlationKey
 * - Ambiguity prevention: If multiple candidates match, DO NOT GUESS; audit and hold
 * - Exactly-once financial recovery: Protects already-recovered opportunities
 */
export async function processWebhookFeedback(params: WebhookFeedbackParams): Promise<WebhookFeedbackResult> {
  const { tenantId, eventType, webhookEventId, payload } = params

  const paymentPayload = payload?.payload?.payment?.entity || payload?.payment?.entity
  const orderPayload = payload?.payload?.order?.entity || payload?.order?.entity
  const subPayload = payload?.payload?.subscription?.entity || payload?.subscription?.entity

  const providerPaymentId = params.providerPaymentId || paymentPayload?.id
  const providerOrderId = params.providerOrderId || orderPayload?.id || paymentPayload?.order_id
  const providerSubscriptionId = params.providerSubscriptionId || subPayload?.id

  // If there are no identifying payment/order/subscription references, nothing to correlate
  if (!providerPaymentId && !providerOrderId && !providerSubscriptionId) {
    return {
      matched: false,
      ambiguous: false,
      reconciled: false,
      reason: 'No provider payment, order, or subscription identifiers in webhook payload'
    }
  }

  // 1. Search for matching opportunities strictly scoped to this tenant
  // We search for opportunities that reference this payment, order, subscription, or matching correlationKey
  const candidateOpps = await prisma.recoveryOpportunity.findMany({
    where: {
      tenantId,
      OR: [
        ...(providerPaymentId ? [
          { payment: { providerPaymentId } },
          { correlationKey: { contains: providerPaymentId } },
          { executions: { some: { OR: [{ externalReference: providerPaymentId }, { idempotencyKey: { contains: providerPaymentId } }] } } }
        ] : []),
        ...(providerOrderId ? [
          { order: { providerOrderId } },
          { correlationKey: { contains: providerOrderId } }
        ] : []),
        ...(providerSubscriptionId ? [
          { subscription: { providerSubscriptionId } },
          { correlationKey: { contains: providerSubscriptionId } }
        ] : [])
      ]
    },
    include: {
      actions: { orderBy: { createdAt: 'desc' }, take: 1 },
      executions: { orderBy: { createdAt: 'desc' }, take: 3 },
      outcomes: { orderBy: { occurredAt: 'desc' } }
    }
  })

  // 2. If no candidate opportunity matches, this is an organic transaction, not an active recovery
  if (candidateOpps.length === 0) {
    return {
      matched: false,
      ambiguous: false,
      reconciled: false,
      reason: 'No active recovery opportunity matched payment/order reference'
    }
  }

  // 3. Ambiguity check: If multiple separate active opportunities match, DO NOT GUESS!
  const activeCandidates = candidateOpps.filter(
    o => o.status === OpportunityStatus.DETECTED || o.status === OpportunityStatus.IN_PROGRESS
  )

  if (activeCandidates.length > 1) {
    await logAuditEvent({
      tenantId,
      eventType: 'RECOVERY_RECONCILIATION_AMBIGUOUS',
      entityType: 'WebhookEvent',
      entityId: webhookEventId,
      metadata: {
        eventType,
        providerPaymentId,
        candidateOpportunityIds: activeCandidates.map(c => c.id),
        message: 'Multiple active opportunities matched the same payment reference. Held for operator review.'
      }
    })

    return {
      matched: true,
      ambiguous: true,
      reconciled: false,
      reason: 'Multiple active opportunities matched. Reconciliation held to prevent misattribution.'
    }
  }

  // Exact deterministic match resolved
  const opportunity = activeCandidates[0] || candidateOpps[0]

  // 4. Check for existing successful outcome to enforce EXACTLY-ONCE accounting
  const existingSuccessOutcome = (opportunity.outcomes || []).find(
    o => o.type === OutcomeType.SUCCESS &&
    (providerPaymentId && o.providerReference === providerPaymentId)
  )

  if (existingSuccessOutcome) {
    return {
      matched: true,
      ambiguous: false,
      reconciled: true,
      opportunityId: opportunity.id,
      outcomeId: existingSuccessOutcome.id,
      reason: 'Opportunity already verified recovered for this payment reference (Idempotent)'
    }
  }

  // Find related execution (most recent in-flight or completed)
  const relatedExecution = opportunity.executions?.[0] || null
  const relatedAction = opportunity.actions?.[0] || null

  // 5. Outcome Reconciliation based on verified webhook event type
  if (eventType === 'payment.captured' || eventType === 'order.paid' || eventType === 'subscription.charged') {
    const amountMinor = params.amountMinor || paymentPayload?.amount || orderPayload?.amount || opportunity.recoverableAmountMinor
    const currency = params.currency || paymentPayload?.currency || 'INR'

    // Mark execution as SUCCEEDED if it was running/queued
    if (relatedExecution && relatedExecution.status !== 'SUCCEEDED') {
      await prisma.recoveryExecution.update({
        where: { id: relatedExecution.id },
        data: {
          status: 'SUCCEEDED',
          externalReference: providerPaymentId || relatedExecution.externalReference,
          completedAt: new Date()
        }
      })
    }

    const outcomeResult = await reconcileRecoveryOutcome({
      tenantId,
      opportunityId: opportunity.id,
      actionId: relatedAction?.id,
      executionId: relatedExecution?.id,
      outcomeType: OutcomeType.SUCCESS,
      recoveredAmountMinor: amountMinor,
      unrecoveredAmountMinor: 0,
      currency,
      provider: 'razorpay_webhook_feedback',
      providerReference: providerPaymentId || providerOrderId,
      reason: `Verified gateway receipt: ${eventType} confirmed payment of ₹${(amountMinor / 100).toFixed(2)}`,
      details: {
        eventType,
        providerPaymentId,
        providerOrderId,
        webhookEventId
      }
    })

    // Link WebhookEvent directly to RecoveryOutcome in database
    if (webhookEventId && outcomeResult.outcome?.id) {
      await prisma.recoveryOutcome.update({
        where: { id: outcomeResult.outcome.id },
        data: { webhookEventId }
      })
    }

    await logAuditEvent({
      tenantId,
      opportunityId: opportunity.id,
      eventType: 'PAYMENT_CONFIRMED',
      entityType: 'RecoveryOpportunity',
      entityId: opportunity.id,
      metadata: {
        eventType,
        recoveredAmountMinor: amountMinor,
        providerPaymentId,
        webhookEventId
      }
    })

    return {
      matched: true,
      ambiguous: false,
      reconciled: true,
      opportunityId: opportunity.id,
      executionId: relatedExecution?.id,
      outcomeId: outcomeResult.outcome?.id,
      reason: `Successfully confirmed financial recovery via ${eventType}`
    }

  } else if (eventType === 'payment.failed') {
    // If a payment attempt failed under an active execution
    if (relatedExecution && relatedExecution.status === 'RUNNING') {
      await prisma.recoveryExecution.update({
        where: { id: relatedExecution.id },
        data: {
          status: 'FAILED',
          failureReason: paymentPayload?.error_description || 'Payment retry failed at gateway',
          completedAt: new Date()
        }
      })
    }

    await logAuditEvent({
      tenantId,
      opportunityId: opportunity.id,
      eventType: 'PAYMENT_FAILED',
      entityType: 'RecoveryOpportunity',
      entityId: opportunity.id,
      metadata: {
        eventType,
        providerPaymentId,
        errorDescription: paymentPayload?.error_description
      }
    })

    return {
      matched: true,
      ambiguous: false,
      reconciled: false,
      opportunityId: opportunity.id,
      executionId: relatedExecution?.id,
      reason: 'Payment failure recorded and correlated to opportunity'
    }
  }

  return {
    matched: true,
    ambiguous: false,
    reconciled: false,
    opportunityId: opportunity.id,
    reason: `Webhook event '${eventType}' acknowledged without outcome state change`
  }
}
