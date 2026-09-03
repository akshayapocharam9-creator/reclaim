import { Payment, PaymentAttempt, CheckoutSession, Subscription, OpportunityType, PriorityLevel } from '@prisma/client'
import { DetectedOpportunity, RevenueDetectionResult } from './types'
import { detectPaymentFailures } from './detect-payments'
import { detectCheckoutAbandonments } from './detect-checkouts'
import { detectSubscriptionFailures } from './detect-subscriptions'

type PaymentWithAttempts = Payment & { attempts: PaymentAttempt[] }

export interface RevenueEngineInput {
  payments: PaymentWithAttempts[]
  checkoutSessions: CheckoutSession[]
  subscriptions: Subscription[]
}

/**
 * Runs the deterministic revenue leak detection engine over provided data.
 * Pure function architecture makes this easily testable and decoupled from DB queries.
 */
export function runRevenueLeakDetection(data: RevenueEngineInput): RevenueDetectionResult {
  let opportunities: DetectedOpportunity[] = []

  opportunities = opportunities.concat(detectPaymentFailures(data.payments))
  opportunities = opportunities.concat(detectCheckoutAbandonments(data.checkoutSessions))
  opportunities = opportunities.concat(detectSubscriptionFailures(data.subscriptions))

  let totalAmountAtRiskMinor = 0
  let totalEstimatedRecoverableAmountMinor = 0
  
  const countsByType = {
    [OpportunityType.PAYMENT_FAILURE]: 0,
    [OpportunityType.REPEATED_PAYMENT_FAILURE]: 0,
    [OpportunityType.CHECKOUT_ABANDONMENT]: 0,
    [OpportunityType.SUBSCRIPTION_FAILURE]: 0,
  }

  const countsByPriority = {
    [PriorityLevel.LOW]: 0,
    [PriorityLevel.MEDIUM]: 0,
    [PriorityLevel.HIGH]: 0,
    [PriorityLevel.CRITICAL]: 0,
  }

  for (const opp of opportunities) {
    totalAmountAtRiskMinor += opp.amountAtRiskMinor
    totalEstimatedRecoverableAmountMinor += opp.estimatedRecoverableAmountMinor
    countsByType[opp.type]++
    countsByPriority[opp.priority]++
  }

  return {
    opportunities,
    totalAmountAtRiskMinor,
    totalEstimatedRecoverableAmountMinor,
    countsByType,
    countsByPriority
  }
}
