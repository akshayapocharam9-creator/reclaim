/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck
import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { POST } from '../../api/webhooks/razorpay/route'
import prisma from '../prisma'
import { syncTenantOpportunities } from './persist-insights'
import { createSessionToken } from '../auth/session'

async function runTests() {
  console.log('--- Running Live Pipeline Tests ---')

  const owner = await prisma.user.findUnique({
    where: { email: 'owner@demosaas.com' },
    include: { memberships: true }
  })
  const TENANT_ID = owner?.memberships[0]?.tenantId || 'cmtkeayky00005qkzmnagbcbb'
  const SECRET = 'test_secret'

  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET
  process.env.RAZORPAY_TENANT_ID = TENANT_ID
  process.env.NEXT_PUBLIC_DEV_TENANT_ID = TENANT_ID

  // Mock Data Store
  const mockDb = {
    webhookEvents: new Set(),
    opportunities: [],
    payments: [{ id: 'pay_live_test_1', customerId: 'cust_live_1', amountMinor: 50000, tenantId: TENANT_ID, status: 'FAILED' }],
    attempts: [{ id: 'att_1', paymentId: 'pay_live_test_1', amountMinor: 50000, status: 'FAILED' }],
    checkouts: [],
    subscriptions: [],
    customers: [{ id: 'cust_live_1', name: 'Razorpay Customer' }]
  }

  // Safely Mock Prisma
  prisma.tenant.findUnique = async () => ({ id: TENANT_ID })
  
  prisma.$transaction = async (cb) => {
    if (typeof cb === 'function') {
      const tx = {
        webhookEvent: {
          create: async (args) => {
            if (mockDb.webhookEvents.has(args.data.eventId)) {
               const error = new Error('Unique constraint failed'); error.code = 'P2002'; throw error;
            }
            mockDb.webhookEvents.add(args.data.eventId)
            return { id: 'we_1' }
          }
        },
        customer: { upsert: async () => ({ id: 'cust_live_1' }) },
        order: { findUnique: async () => null, upsert: async () => ({ id: 'ord_1' }) },
        payment: { findUnique: async () => null, upsert: async () => ({ id: 'pay_live_test_1' }) },
        paymentAttempt: { count: async () => 0, create: async () => ({ id: 'att_1' }) },
        subscription: { findUnique: async () => null, upsert: async () => ({ id: 'sub_1' }) },
        recoveryOpportunity: {
          create: async (args) => {
            const opp = { id: `opp_${Date.now()}`, ...args.data }
            mockDb.opportunities.push(opp)
            return opp
          },
          update: async (args) => {
            const index = mockDb.opportunities.findIndex(o => o.id === args.where.id)
            if (index >= 0) mockDb.opportunities[index] = { ...mockDb.opportunities[index], ...args.data }
            return mockDb.opportunities[index]
          }
        }
      }
      return cb(tx)
    } else if (Array.isArray(cb)) {
      // It's an array of PrismaPromises from syncTenantOpportunities
      // Execute them sequentially
      for (const op of cb) {
        if (op.action === 'create') {
          const opp = { id: `opp_${Date.now()}`, ...op.args.data }
          mockDb.opportunities.push(opp)
        } else if (op.action === 'update') {
          const index = mockDb.opportunities.findIndex(o => o.id === op.args.where.id)
          if (index >= 0) mockDb.opportunities[index] = { ...mockDb.opportunities[index], ...op.args.data }
        }
      }
    }
  }

  // Mock standard reads used by adapter & API
  prisma.payment.findMany = async () => mockDb.payments.map(p => ({ ...p, attempts: mockDb.attempts.filter(a => a.paymentId === p.id) }))
  prisma.checkoutSession.findMany = async () => mockDb.checkouts
  prisma.subscription.findMany = async () => mockDb.subscriptions
  prisma.recoveryOpportunity.findMany = async () => mockDb.opportunities
  
  // Intercept the API's specialized findMany with include
  const originalFindMany = prisma.recoveryOpportunity.findMany
  prisma.recoveryOpportunity.findMany = async (args) => {
    return mockDb.opportunities.map(opp => {
      let customer = null;
      if (args?.include?.customer) {
        customer = mockDb.customers.find(c => c.id === opp.customerId)
      }
      return { ...opp, customer }
    })
  }

  // Intercept create/update for the array format inside $transaction
  prisma.recoveryOpportunity.create = (args) => ({ action: 'create', args })
  prisma.recoveryOpportunity.update = (args) => ({ action: 'update', args })

  function createSignedRequest(payload: any, eventId: string) {
    const rawBody = JSON.stringify(payload)
    const signature = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex')
    return new NextRequest('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      body: rawBody,
      headers: {
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId,
        'content-type': 'application/json'
      }
    })
  }

  const payload = {
    event: 'payment.failed',
    payload: { 
      payment: { 
        entity: { 
          id: 'pay_live_test_1', 
          amount: 50000, 
          currency: 'INR',
          customer_id: 'cust_live_1',
          error_code: 'BAD_REQUEST_ERROR',
          error_description: 'Test payment failed'
        } 
      } 
    }
  }

  console.log('1. Simulating Webhook Delivery...')
  const req = createSignedRequest(payload, 'evt_live_1')
  const res = await POST(req)
  console.assert(res.status === 200, 'Webhook should process successfully')

  await new Promise(resolve => setTimeout(resolve, 100))

  console.log('2. Verifying Intelligence Persistence...')
  console.assert(mockDb.opportunities.length > 0, 'Should have generated at least one opportunity (PAYMENT_FAILURE)')
  
  console.log('3. Verifying Idempotency of Insights...')
  // Sync again explicitly to test idempotency
  await syncTenantOpportunities(TENANT_ID)
  
  console.assert(mockDb.opportunities.length === 1, 'Should NOT duplicate the opportunity insight for the same payment failure')

  console.log('4. Verifying API Exposure...')
  const { GET } = await import('../../api/revenue/opportunities/route')
  const pipelineToken = createSessionToken({
    userId: owner!.id,
    email: owner!.email,
    tenantId: TENANT_ID,
    role: 'OWNER' as any
  })
  const apiReq = new NextRequest(`http://localhost/api/revenue/opportunities`, {
    headers: { authorization: `Bearer ${pipelineToken}` }
  })
  const apiRes = await GET(apiReq)
  const apiData = await apiRes.json()
  console.log('pipeline apiRes status:', apiRes.status, 'body:', apiData)
  
  console.assert(apiData.opportunities.length === mockDb.opportunities.length, 'API should return the exact persisted opportunities')
  console.assert(apiData.opportunities[0].customerName === 'Razorpay Customer', 'API should successfully hydrate customer name')

  console.log('5. Verifying Intelligence Failure Safety...')
  // Temporarily break syncTenantOpportunities to throw an error
  const { syncTenantOpportunities: originalSync } = await import('./persist-insights')
  
  // Create a specialized mock payload to test the webhook handling of this failure
  const payloadFail = {
    event: 'payment.failed',
    payload: { 
      payment: { 
        entity: { 
          id: 'pay_live_test_fail', 
          amount: 60000, 
          currency: 'INR',
          customer_id: 'cust_live_1',
          error_code: 'BAD_REQUEST_ERROR'
        } 
      } 
    }
  }

  let errorCaught = false;
  
  // We use a manual mock to intercept the floating promise in test environment 
  // since standard jest.mock is not available in pure tsx.
  // Actually, since we can't easily mock the imported function inside `razorpay-processor` 
  // dynamically without a module loader hook, we can force the DB to throw during findMany!
  
  const originalFindManySub = prisma.subscription.findMany
  prisma.subscription.findMany = async () => {
    errorCaught = true
    throw new Error('Simulated Intelligence DB Failure')
  }

  const reqFail = createSignedRequest(payloadFail, 'evt_live_fail')
  const resFail = await POST(reqFail)
  
  console.assert(resFail.status === 200, 'Webhook POST should STILL return 200 OK even if intelligence fails')
  console.assert(errorCaught === true, 'Intelligence error should have triggered')
  console.assert(mockDb.webhookEvents.has('evt_live_fail'), 'Webhook event should have been safely persisted to DB')

  // Restore
  prisma.subscription.findMany = originalFindManySub

  console.log('--- Live Pipeline Tests Passed! ---')
}

runTests().catch(console.error)
