import { OpportunityType, PriorityLevel } from '@prisma/client'

/**
 * Deterministic scoring formula for revenue leak opportunities.
 * 
 * Score Formula (0-100 scale):
 * 1. Base Score based on Opportunity Type:
 *    - SUBSCRIPTION_FAILURE: +40 (Recurring revenue is highly valuable)
 *    - REPEATED_PAYMENT_FAILURE: +30
 *    - PAYMENT_FAILURE: +20
 *    - CHECKOUT_ABANDONMENT: +10
 * 
 * 2. Amount Score (based on INR minor units, 100 paise = 1 INR):
 *    - > 1,00,000 INR (1,00,00,000 minor) => +50
 *    - > 50,000 INR (50,00,000 minor) => +40
 *    - > 10,000 INR (10,00,000 minor) => +30
 *    - > 1,000 INR (1,00,000 minor) => +20
 *    - < 1,000 INR => +10
 * 
 * 3. Priority Mapping:
 *    - 0-35: LOW
 *    - 36-60: MEDIUM
 *    - 61-80: HIGH
 *    - 81-100: CRITICAL
 */
export function calculateScoreAndPriority(type: OpportunityType, amountMinor: number): { score: number, priority: PriorityLevel } {
  let score = 0

  switch (type) {
    case OpportunityType.SUBSCRIPTION_FAILURE:
      score += 40
      break
    case OpportunityType.REPEATED_PAYMENT_FAILURE:
      score += 30
      break
    case OpportunityType.PAYMENT_FAILURE:
      score += 20
      break
    case OpportunityType.CHECKOUT_ABANDONMENT:
      score += 10
      break
  }

  if (amountMinor > 10000000) {
    score += 50
  } else if (amountMinor > 5000000) {
    score += 40
  } else if (amountMinor > 1000000) {
    score += 30
  } else if (amountMinor > 100000) {
    score += 20
  } else {
    score += 10
  }

  score = Math.min(score, 100)

  let priority: PriorityLevel = PriorityLevel.LOW
  if (score > 80) {
    priority = PriorityLevel.CRITICAL
  } else if (score > 60) {
    priority = PriorityLevel.HIGH
  } else if (score > 35) {
    priority = PriorityLevel.MEDIUM
  }

  return { score, priority }
}

/**
 * RECOVERY_ESTIMATES
 * 
 * IMPORTANT: These are DEMO/ESTIMATION assumptions used ONLY for the prototype.
 * These do NOT represent actual recovered revenue.
 * They model expected recoverability strictly for deterministic dashboard data purposes.
 */
export const RECOVERY_ESTIMATES = {
  SUBSCRIPTION: 1.0,
  PAYMENT_SINGLE: 0.90,
  PAYMENT_REPEATED: 0.70,
  CHECKOUT: 0.25
}

/**
 * Deterministic recovery value calculation.
 * Returns the ESTIMATED recoverable minor units. Must not be treated as guaranteed recovery.
 */
export function calculateEstimatedRecoverableAmount(type: OpportunityType, actualAmountAtRiskMinor: number): number {
  let multiplier = 1.0

  switch (type) {
    case OpportunityType.SUBSCRIPTION_FAILURE:
      multiplier = RECOVERY_ESTIMATES.SUBSCRIPTION
      break
    case OpportunityType.PAYMENT_FAILURE:
      multiplier = RECOVERY_ESTIMATES.PAYMENT_SINGLE
      break
    case OpportunityType.REPEATED_PAYMENT_FAILURE:
      multiplier = RECOVERY_ESTIMATES.PAYMENT_REPEATED
      break
    case OpportunityType.CHECKOUT_ABANDONMENT:
      multiplier = RECOVERY_ESTIMATES.CHECKOUT
      break
  }

  return Math.floor(actualAmountAtRiskMinor * multiplier)
}
