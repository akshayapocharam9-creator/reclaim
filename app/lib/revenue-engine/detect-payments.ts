import { Payment, PaymentAttempt, OpportunityType } from '@prisma/client'
import { DetectedOpportunity } from './types'
import { calculateScoreAndPriority, calculateEstimatedRecoverableAmount } from './scoring'

type PaymentWithAttempts = Payment & { attempts: PaymentAttempt[] }

export function detectPaymentFailures(payments: PaymentWithAttempts[]): DetectedOpportunity[] {
  const opportunities: DetectedOpportunity[] = []

  for (const payment of payments) {
    if (payment.status !== 'FAILED') {
      continue
    }

    const failedAttempts = payment.attempts.filter(a => a.status === 'FAILED')
    
    if (failedAttempts.length === 0) {
      continue 
    }

    const isRepeated = failedAttempts.length > 1
    const type = isRepeated ? OpportunityType.REPEATED_PAYMENT_FAILURE : OpportunityType.PAYMENT_FAILURE

    const { score, priority } = calculateScoreAndPriority(type, payment.amountMinor)
    const estimatedRecoverableAmountMinor = calculateEstimatedRecoverableAmount(type, payment.amountMinor)

    const latestAttempt = failedAttempts.sort((a, b) => b.attemptedAt.getTime() - a.attemptedAt.getTime())[0]

    opportunities.push({
      type,
      tenantId: payment.tenantId,
      customerId: payment.customerId,
      orderId: payment.orderId || undefined,
      paymentId: payment.id,
      amountAtRiskMinor: payment.amountMinor, // Actual DB money
      estimatedRecoverableAmountMinor,        // Modelled estimate
      priority,
      score,
      confidenceScore: isRepeated ? 0.9 : 0.8,
      reason: isRepeated 
        ? `Repeated payment failure detected (${failedAttempts.length} attempts).`
        : `Payment failed on first attempt.`,
      evidence: {
        failedAttemptsCount: failedAttempts.length,
        latestFailureCode: latestAttempt.failureCode || 'unknown',
        latestFailureReason: latestAttempt.failureReason || 'unknown',
      },
      recommendation: {
        action: isRepeated ? 'CONTACT_CUSTOMER' : 'RETRY_PAYMENT',
        channel: 'email'
      },
      detectedAt: new Date()
    })
  }

  return opportunities
}
