import { RecoveryOpportunity } from '@prisma/client'
import {
  RecoveryRecommendation,
  RecoveryAction,
  RecoveryPriority,
  RecoveryChannel
} from './types'

export function generateRecommendation(opportunity: RecoveryOpportunity): RecoveryRecommendation {
  let action = RecoveryAction.MONITOR
  let priority = RecoveryPriority.LOW
  let urgency: 'IMMEDIATE' | 'HIGH' | 'NORMAL' | 'LOW' = 'LOW'
  let channel = RecoveryChannel.NONE
  let reason = 'Default fallback recommendation.'
  let confidence = 0.5

  const now = new Date()
  const daysSinceDetection = Math.floor((now.getTime() - opportunity.detectedAt.getTime()) / (1000 * 60 * 60 * 24))

  // Determine priority based on value
  const amountMinor = opportunity.amountAtRiskMinor
  const isHighValue = amountMinor > 1000000 // e.g. > 10,000 INR

  // Basic classification based on Opportunity Type
  if (opportunity.type === 'PAYMENT_FAILURE') {
    action = RecoveryAction.RETRY_PAYMENT
    channel = RecoveryChannel.AUTOMATED
    priority = isHighValue ? RecoveryPriority.HIGH : RecoveryPriority.MEDIUM
    urgency = isHighValue ? 'IMMEDIATE' : 'NORMAL'
    reason = `Payment failed. We recommend an automated retry attempt for the outstanding amount of ${amountMinor / 100}.`
    confidence = 0.85
  } else if (opportunity.type === 'REPEATED_PAYMENT_FAILURE') {
    action = RecoveryAction.CONTACT_CUSTOMER
    channel = RecoveryChannel.MANUAL
    priority = isHighValue ? RecoveryPriority.CRITICAL : RecoveryPriority.HIGH
    urgency = 'IMMEDIATE'
    reason = `Multiple payment failures detected. Automated retries have likely failed. Immediate manual outreach is recommended to secure ${amountMinor / 100}.`
    confidence = 0.95
  } else if (opportunity.type === 'CHECKOUT_ABANDONMENT') {
    action = RecoveryAction.SEND_PAYMENT_REMINDER
    channel = RecoveryChannel.EMAIL
    priority = RecoveryPriority.MEDIUM
    urgency = 'NORMAL'
    reason = `Checkout abandoned. We recommend sending an automated email reminder with a checkout link.`
    confidence = 0.65
  } else if (opportunity.type === 'SUBSCRIPTION_FAILURE') {
    action = RecoveryAction.ESCALATE
    channel = RecoveryChannel.EMAIL
    priority = isHighValue ? RecoveryPriority.CRITICAL : RecoveryPriority.HIGH
    urgency = 'HIGH'
    reason = `Subscription renewal failed. An immediate escalation via email is required to prevent churn.`
    confidence = 0.90
  }

  // Time-based urgency modifiers
  if (daysSinceDetection > 7 && action !== RecoveryAction.ESCALATE) {
    action = RecoveryAction.ESCALATE
    channel = RecoveryChannel.MANUAL
    urgency = 'HIGH'
    reason += ` (Escalated due to aging: failure is older than 7 days.)`
  } else if (daysSinceDetection === 0 && action === RecoveryAction.RETRY_PAYMENT) {
    urgency = 'IMMEDIATE'
  }

  return {
    opportunityId: opportunity.id,
    recommendedAction: action,
    priority,
    urgency,
    reason,
    expectedRecoveryAmountMinor: opportunity.recoverableAmountMinor,
    suggestedChannel: channel,
    confidence,
    generatedAt: new Date().toISOString()
  }
}
