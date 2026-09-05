import prisma from '../prisma'
import { getOrCreateDefaultTenantPolicy } from '../policy/service'
import {
  OpportunityType,
  OpportunityStatus,
  PriorityLevel,
  OrderStatus,
  PaymentStatus,
  ActionType,
  ActionStatus,
  ExecutionStatus,
  OutcomeType
} from '@prisma/client'

/**
 * Bootstraps the verified showcase recovery scenario into a newly created
 * or empty tenant. This ensures any judge or user who signs in with their own
 * account immediately experiences the complete, polished RECLAIM revenue recovery
 * dashboard, policy simulator, audit timeline, and recovery analytics while
 * preserving 100% tenant isolation and real database integrity.
 *
 * Fully idempotent: if the tenant already contains any recovery opportunities,
 * this function exits immediately without modifying anything.
 */
export async function seedTenantShowcaseData(tenantId: string, actorEmail?: string): Promise<boolean> {
  try {
    // 1. Guard check: if tenant already has opportunities, do nothing
    const oppCount = await prisma.recoveryOpportunity.count({
      where: { tenantId }
    })
    if (oppCount > 0) {
      return false
    }

    // 2. Ensure standard default policy exists for the tenant (₹10,000 threshold)
    await getOrCreateDefaultTenantPolicy(tenantId)

    const suffix = tenantId.slice(-8)
    const providerCustId = `showcase_cust_${suffix}`
    const providerOrderId = `showcase_order_${suffix}`
    const providerPayId = `showcase_pay_${suffix}`
    const correlationKey = `PAYMENT_FAILURE_PAY_${providerPayId}`

    // Double check correlationKey does not exist
    const existingOpp = await prisma.recoveryOpportunity.findFirst({
      where: { tenantId, correlationKey }
    })
    if (existingOpp) {
      return false
    }

    // 3. Upsert Customer
    const customer = await prisma.customer.upsert({
      where: {
        tenantId_provider_providerCustomerId: {
          tenantId,
          provider: 'RAZORPAY',
          providerCustomerId: providerCustId
        }
      },
      update: {},
      create: {
        tenantId,
        name: 'Demo Recovery Customer',
        email: actorEmail || `customer_${suffix}@reclaim.local`,
        phone: '+919999999999',
        provider: 'RAZORPAY',
        providerCustomerId: providerCustId
      }
    })

    // 4. Upsert Order
    const order = await prisma.order.upsert({
      where: {
        tenantId_provider_providerOrderId: {
          tenantId,
          provider: 'RAZORPAY',
          providerOrderId
        }
      },
      update: {},
      create: {
        tenantId,
        customerId: customer.id,
        amountMinor: 750000,
        currency: 'INR',
        status: OrderStatus.FAILED,
        provider: 'RAZORPAY',
        providerOrderId,
        metadata: { demo: true, purpose: 'RECLAIM_PRESENTATION' }
      }
    })

    // 5. Upsert Payment
    const payment = await prisma.payment.upsert({
      where: {
        tenantId_provider_providerPaymentId: {
          tenantId,
          provider: 'RAZORPAY',
          providerPaymentId: providerPayId
        }
      },
      update: {},
      create: {
        tenantId,
        customerId: customer.id,
        orderId: order.id,
        amountMinor: 750000,
        currency: 'INR',
        status: PaymentStatus.FAILED,
        provider: 'RAZORPAY',
        providerPaymentId: providerPayId,
        paymentMethod: { method: 'card' },
        metadata: { demo: true, purpose: 'RECLAIM_PRESENTATION' }
      }
    })

    // 6. Create PaymentAttempt
    await prisma.paymentAttempt.create({
      data: {
        tenantId,
        customerId: customer.id,
        orderId: order.id,
        paymentId: payment.id,
        attemptNumber: 1,
        amountMinor: 750000,
        currency: 'INR',
        status: 'FAILED',
        failureCode: 'PAYMENT_FAILED',
        failureReason: 'Demo payment failure for recovery workflow',
        gatewayResponse: { demo: true }
      }
    })

    // 7. Create RecoveryOpportunity (₹7,500 at risk, ₹6,750 recoverable, RECOVERED)
    const opportunity = await prisma.recoveryOpportunity.create({
      data: {
        tenantId,
        customerId: customer.id,
        orderId: order.id,
        paymentId: payment.id,
        type: OpportunityType.PAYMENT_FAILURE,
        status: OpportunityStatus.RECOVERED,
        amountAtRiskMinor: 750000,
        recoverableAmountMinor: 675000,
        priority: PriorityLevel.MEDIUM,
        score: 40,
        confidenceScore: 0.8,
        reason: 'Payment failed on first attempt.',
        evidence: {
          latestFailureCode: 'PAYMENT_FAILED',
          failedAttemptsCount: 1,
          latestFailureReason: 'Demo payment failure for recovery workflow'
        },
        recommendation: {
          action: 'RETRY_PAYMENT',
          channel: 'email',
          aiReasoning: {
            model: 'rule-based-v1',
            summary: 'MEDIUM priority PAYMENT FAILURE of INR 7,500. Recommendation: RETRY PAYMENT.',
            provider: 'deterministic-engine',
            reasoning:
              'Deterministic analysis indicates Payment failed. We recommend an automated retry attempt for the outstanding amount of 7500. Prompt intervention via AUTOMATED maximizes recovery probability.',
            confidence: 0.82,
            isFallback: true,
            generatedAt: new Date().toISOString(),
            riskExplanation:
              'Revenue of INR 7,500 is currently stalled due to payment failure. This appears to be an isolated or early-stage transaction friction.',
            recommendedCommunication: 'Automated retry communication via email.',
            suggestedCustomerMessage:
              'Hi Demo Recovery Customer, we noticed an issue processing your recent payment of INR 7,500. Please review your billing details to keep your service active.'
          }
        },
        correlationKey,
        detectedAt: new Date(),
        resolvedAt: new Date()
      }
    })

    // 8. Create RecoveryAction
    const action = await prisma.recoveryAction.create({
      data: {
        tenantId,
        opportunityId: opportunity.id,
        type: ActionType.RETRY_PAYMENT,
        status: ActionStatus.EXECUTED,
        channel: 'AUTOMATED',
        expectedRecoveryAmountMinor: 675000,
        notes:
          'Action initiated: Payment failed. We recommend an automated retry attempt for the outstanding amount of 7500. | Confirmed recovered via operator review',
        recommendationSnapshot: {
          reason:
            'Payment failed. We recommend an automated retry attempt for the outstanding amount of 7500.',
          urgency: 'IMMEDIATE',
          priority: 'MEDIUM',
          confidence: 0.85,
          opportunityId: opportunity.id,
          suggestedChannel: 'AUTOMATED',
          recommendedAction: 'RETRY_PAYMENT',
          expectedRecoveryAmountMinor: 675000
        },
        approvedAt: new Date(),
        executedAt: new Date()
      }
    })

    // 9. Create RecoveryOutcome (₹6,750 recovered)
    await prisma.recoveryOutcome.create({
      data: {
        tenantId,
        opportunityId: opportunity.id,
        actionId: action.id,
        type: OutcomeType.SUCCESS,
        recoveredAmountMinor: 675000,
        unrecoveredAmountMinor: 75000,
        currency: 'INR',
        provider: 'reclaim_agent',
        reason: 'Confirmed recovered via operator review',
        details: {
          notes: 'Confirmed recovered via operator review'
        },
        occurredAt: new Date()
      }
    })

    // 10. Create RecoveryExecution
    await prisma.recoveryExecution.create({
      data: {
        tenantId,
        opportunityId: opportunity.id,
        recoveryActionId: action.id,
        actionType: 'RETRY_PAYMENT',
        provider: 'RAZORPAY_PAYMENT_PROVIDER',
        status: ExecutionStatus.SUCCEEDED,
        idempotencyKey: `exec_${tenantId}_${action.id}_${Date.now()}`,
        attemptCount: 1,
        maxAttempts: 3,
        externalReference: `rzp_sim_pay_${Date.now()}_7500`,
        metadata: {
          channel: 'AUTOMATED',
          isRetryable: false,
          messageBody:
            'Hi Demo Recovery Customer, we noticed an issue processing your recent payment of INR 7,500. Please review your billing details to keep your service active.',
          customMetadata: {},
          messageSubject: 'Recovery Notice: Payment for Demo Recovery Customer',
          providerResult: {
            currency: 'INR',
            simulated: true,
            actionType: 'RETRY_PAYMENT',
            amountMinor: 675000,
            idempotencyKey: `exec_${tenantId}_${action.id}_${Date.now()}`,
            targetCustomer: customer.id
          }
        },
        startedAt: new Date(),
        completedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: actorEmail || 'system',
        heartbeatAt: new Date(),
        requiresReview: false
      }
    })

    // 11. Create DunningCadence (COMPLETED)
    await prisma.dunningCadence.create({
      data: {
        tenantId,
        opportunityId: opportunity.id,
        currentStep: 1,
        status: 'COMPLETED',
        channel: 'EMAIL',
        scheduledAt: new Date(),
        completedAt: new Date(),
        idempotencyKey: `cadence_init_${opportunity.id}`,
        metadata: {
          stoppedAt: new Date().toISOString(),
          stoppedReason: 'Opportunity reached terminal state: RECOVERED',
          terminalStatus: 'RECOVERED'
        }
      }
    })

    // 12. Create Timeline Audit Events
    const auditEntries = [
      {
        eventType: 'DUNNING_SCHEDULED',
        entityType: 'DunningCadence',
        entityId: opportunity.id,
        metadata: { step: 1, scheduledAt: new Date().toISOString() }
      },
      {
        eventType: 'ACTION_CREATED',
        entityType: 'RecoveryAction',
        entityId: action.id,
        metadata: {
          channel: 'AUTOMATED',
          actionType: 'RETRY_PAYMENT',
          expectedRecoveryAmountMinor: 675000
        }
      },
      {
        eventType: 'EXECUTION_QUEUED',
        entityType: 'RecoveryExecution',
        entityId: opportunity.id,
        metadata: {
          actionId: action.id,
          provider: 'RAZORPAY_PAYMENT_PROVIDER',
          actionType: 'RETRY_PAYMENT'
        }
      },
      {
        eventType: 'EXECUTION_STARTED',
        entityType: 'RecoveryExecution',
        entityId: opportunity.id,
        metadata: { attemptCount: 1 }
      },
      {
        eventType: 'EXECUTION_SUCCEEDED',
        entityType: 'RecoveryExecution',
        entityId: opportunity.id,
        metadata: { mode: 'audit', status: 'SUCCEEDED', provider: 'RAZORPAY_PAYMENT_PROVIDER' }
      },
      {
        eventType: 'RECOVERY_CONFIRMED',
        entityType: 'RecoveryOutcome',
        entityId: opportunity.id,
        metadata: { actionId: action.id, recoveredAmountMinor: 675000 }
      }
    ]

    for (const a of auditEntries) {
      await prisma.auditEvent.create({
        data: {
          tenantId,
          opportunityId: opportunity.id,
          actorEmail: actorEmail || 'system',
          eventType: a.eventType,
          entityType: a.entityType,
          entityId: a.entityId,
          metadata: a.metadata,
          timestamp: new Date()
        }
      })
    }

    return true
  } catch (err) {
    console.error('[SEED_TENANT_SHOWCASE_DATA_ERROR]', err)
    return false
  }
}
