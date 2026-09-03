import { Subscription, SubscriptionStatus, OpportunityType } from '@prisma/client'
import { DetectedOpportunity } from './types'
import { calculateScoreAndPriority, calculateEstimatedRecoverableAmount } from './scoring'

export function detectSubscriptionFailures(subscriptions: Subscription[]): DetectedOpportunity[] {
  const opportunities: DetectedOpportunity[] = []

  for (const sub of subscriptions) {
    if (sub.status !== SubscriptionStatus.PAST_DUE && sub.status !== SubscriptionStatus.UNPAID) {
      continue
    }

    const { score, priority } = calculateScoreAndPriority(OpportunityType.SUBSCRIPTION_FAILURE, sub.amountMinor)
    const estimatedRecoverableAmountMinor = calculateEstimatedRecoverableAmount(OpportunityType.SUBSCRIPTION_FAILURE, sub.amountMinor)

    opportunities.push({
      type: OpportunityType.SUBSCRIPTION_FAILURE,
      tenantId: sub.tenantId,
      customerId: sub.customerId,
      subscriptionId: sub.id,
      amountAtRiskMinor: sub.amountMinor, // Actual DB money
      estimatedRecoverableAmountMinor,    // Modelled estimate
      priority,
      score,
      confidenceScore: 0.95, 
      reason: `Subscription has entered ${sub.status} state.`,
      evidence: {
        planName: sub.planName,
        status: sub.status,
        billingInterval: sub.billingInterval,
        nextChargeAt: sub.nextChargeAt,
      },
      recommendation: {
        action: 'RETRY_SUBSCRIPTION',
        channel: 'email'
      },
      detectedAt: new Date()
    })
  }

  return opportunities
}
