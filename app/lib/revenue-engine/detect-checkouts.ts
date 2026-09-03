import { CheckoutSession, SessionStatus, OpportunityType } from '@prisma/client'
import { DetectedOpportunity } from './types'
import { calculateScoreAndPriority, calculateEstimatedRecoverableAmount } from './scoring'

export function detectCheckoutAbandonments(sessions: CheckoutSession[]): DetectedOpportunity[] {
  const opportunities: DetectedOpportunity[] = []
  const now = new Date()

  for (const session of sessions) {
    // COMPLETED must NEVER be classified as abandoned.
    if (session.status === SessionStatus.COMPLETED) {
      continue
    }

    // EXPIRED should be classified as abandoned/unfinished.
    const isExplicitlyExpired = session.status === SessionStatus.EXPIRED

    // OPEN should only be classified as abandoned when expiresAt exists and is in the past.
    // OPEN without an expired expiresAt must NOT be classified as abandoned.
    const isExpiredOpen = session.status === SessionStatus.OPEN && session.expiresAt && session.expiresAt < now

    if (!isExplicitlyExpired && !isExpiredOpen) {
      continue
    }

    const { score, priority } = calculateScoreAndPriority(OpportunityType.CHECKOUT_ABANDONMENT, session.amountMinor)
    const estimatedRecoverableAmountMinor = calculateEstimatedRecoverableAmount(OpportunityType.CHECKOUT_ABANDONMENT, session.amountMinor)

    opportunities.push({
      type: OpportunityType.CHECKOUT_ABANDONMENT,
      tenantId: session.tenantId,
      customerId: session.customerId || undefined,
      orderId: session.orderId || undefined,
      checkoutSessionId: session.id,
      amountAtRiskMinor: session.amountMinor, // Actual DB money
      estimatedRecoverableAmountMinor,        // Modelled estimate
      priority,
      score,
      confidenceScore: 0.6,
      reason: `Customer abandoned checkout session.`,
      evidence: {
        status: session.status,
        startedAt: session.startedAt,
        isExpiredOpen
      },
      recommendation: {
        action: 'RECOVER_CHECKOUT',
        channel: 'email'
      },
      detectedAt: now
    })
  }

  return opportunities
}
