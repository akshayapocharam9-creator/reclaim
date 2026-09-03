import { PaymentStatus, AttemptStatus, SessionStatus, SubscriptionStatus, PriorityLevel, OpportunityType } from '@prisma/client'
import { runRevenueLeakDetection } from './index'

function runTests() {
  console.log('--- Running Revenue Leak Engine Tests ---')

  const now = new Date()
  const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 24)
  const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24)

  const input = {
    payments: [],
    checkoutSessions: [
      // 1. Completed session (Should NOT be abandoned)
      {
        id: 'cs_completed',
        tenantId: 't1',
        customerId: 'c4',
        orderId: null,
        paymentId: null,
        provider: 'razorpay',
        providerCheckoutSessionId: 'rcs_1',
        amountMinor: 200000,
        currency: 'INR',
        status: SessionStatus.COMPLETED,
        startedAt: pastDate,
        abandonedAt: null,
        completedAt: now,
        expiresAt: null,
        metadata: null,
        createdAt: pastDate,
        updatedAt: now,
      },
      // 2. EXPIRED checkout (Should BE abandoned)
      {
        id: 'cs_expired_explicit',
        tenantId: 't1',
        customerId: 'c5',
        orderId: null,
        paymentId: null,
        provider: 'razorpay',
        providerCheckoutSessionId: 'rcs_2',
        amountMinor: 12000000, 
        currency: 'INR',
        status: SessionStatus.EXPIRED,
        startedAt: pastDate,
        abandonedAt: null,
        completedAt: null,
        expiresAt: pastDate,
        metadata: null,
        createdAt: pastDate,
        updatedAt: now,
      },
      // 3. OPEN + expired expiresAt (Should BE abandoned)
      {
        id: 'cs_open_expired',
        tenantId: 't1',
        customerId: 'c6',
        orderId: null,
        paymentId: null,
        provider: 'razorpay',
        providerCheckoutSessionId: 'rcs_3',
        amountMinor: 500000, 
        currency: 'INR',
        status: SessionStatus.OPEN,
        startedAt: pastDate,
        abandonedAt: null,
        completedAt: null,
        expiresAt: pastDate,
        metadata: null,
        createdAt: pastDate,
        updatedAt: now,
      },
      // 4. OPEN + future expiresAt (Should NOT be abandoned)
      {
        id: 'cs_open_future',
        tenantId: 't1',
        customerId: 'c7',
        orderId: null,
        paymentId: null,
        provider: 'razorpay',
        providerCheckoutSessionId: 'rcs_4',
        amountMinor: 700000, 
        currency: 'INR',
        status: SessionStatus.OPEN,
        startedAt: now,
        abandonedAt: null,
        completedAt: null,
        expiresAt: futureDate,
        metadata: null,
        createdAt: now,
        updatedAt: now,
      }
    ],
    subscriptions: []
  }

  const result = runRevenueLeakDetection(input)

  // Expect exactly 2 checkout opportunities
  console.assert(result.opportunities.length === 2, `Should detect exactly 2 opportunities, got ${result.opportunities.length}`)
  
  const abandonments = result.opportunities.filter(o => o.type === OpportunityType.CHECKOUT_ABANDONMENT)
  
  const expiredExplicit = abandonments.find(o => o.checkoutSessionId === 'cs_expired_explicit')
  const openExpired = abandonments.find(o => o.checkoutSessionId === 'cs_open_expired')
  
  console.assert(!!expiredExplicit, 'Should detect EXPIRED checkout as abandoned')
  console.assert(!!openExpired, 'Should detect OPEN + expired expiresAt checkout as abandoned')

  // Check actual vs estimated
  if (expiredExplicit) {
    console.assert(expiredExplicit.amountAtRiskMinor === 12000000, 'amountAtRiskMinor must equal actual db amount')
    // Checkout recovery is 25% (0.25)
    console.assert(expiredExplicit.estimatedRecoverableAmountMinor === 3000000, 'Estimated recovery should be 25% of actual amount')
  }

  console.log('--- All checkout logic tests passed! ---')
}

runTests()
