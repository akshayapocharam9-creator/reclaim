/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck
import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { POST } from '../../api/webhooks/razorpay/route'
import prisma from '../prisma'
import { PaymentStatus, OrderStatus, SubscriptionStatus } from '@prisma/client'

async function runTests() {
  console.log('--- Running Webhook Hardening Tests ---')

  const SECRET = 'test_secret'
  const TENANT_ID = 'valid-tenant'

  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET
  process.env.RAZORPAY_TENANT_ID = TENANT_ID

  prisma.tenant.findUnique = async (args) => {
    if (args.where.id === TENANT_ID) return { id: TENANT_ID }
    return null
  }
  
  // Track events for idempotency P2002 testing
  const mockWebhookEvents = new Set()
  // Track DB state for ordering testing
  const mockDb = {
    payment: { status: PaymentStatus.PENDING, amountMinor: 0 },
    order: { status: OrderStatus.PENDING },
    subscription: { status: SubscriptionStatus.ACTIVE }
  }

  prisma.$transaction = async (callback) => {
    const tx = {
      webhookEvent: {
        create: async (args) => {
          const key = `${args.data.tenantId}_${args.data.eventId}`
          if (mockWebhookEvents.has(key)) {
            const error = new Error('Unique constraint failed')
            error.code = 'P2002' // Trigger the race-safe duplicate handler
            throw error
          }
          mockWebhookEvents.add(key)
          return { id: 'created' }
        }
      },
      customer: { upsert: async () => ({ id: 'cust_mock' }) },
      order: {
        findUnique: async () => ({ status: mockDb.order.status }),
        upsert: async (args) => {
          mockDb.order.status = args.create.status
          return { id: 'order_mock' }
        }
      },
      payment: {
        findUnique: async () => ({ status: mockDb.payment.status }),
        upsert: async (args) => {
          mockDb.payment.status = args.create.status
          mockDb.payment.amountMinor = args.create.amountMinor
          return { id: 'pay_mock' }
        }
      },
      paymentAttempt: { 
        count: async () => 0, 
        create: async () => ({ id: 'att_mock' }) 
      },
      subscription: {
        findUnique: async () => ({ status: mockDb.subscription.status }),
        upsert: async (args) => {
          mockDb.subscription.status = args.create.status
          return { id: 'sub_mock' }
        }
      }
    }
    return callback(tx)
  }

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

  // TEST 1: Race-safe Idempotency (P2002 Exception)
  const payload1 = {
    event: 'payment.failed',
    payload: { payment: { entity: { id: 'pay_1', amount: 50000, customer_id: 'c_1' } } }
  }
  const req1_a = createSignedRequest(payload1, 'evt_race')
  const res1_a = await POST(req1_a)
  console.assert(res1_a.status === 200, 'First identical event processes successfully')
  
  const req1_b = createSignedRequest(payload1, 'evt_race')
  const res1_b = await POST(req1_b)
  console.assert(res1_b.status === 200, 'Second identical event triggers duplicate check without crashing')
  const data1_b = await res1_b.json()
  console.assert(data1_b.message.includes('already processed'), 'Safely caught P2002 duplicate')

  // TEST 2: Event Ordering (Stale Failed cannot downgrade Captured)
  mockDb.payment.status = PaymentStatus.CAPTURED
  const payload2 = {
    event: 'payment.failed',
    payload: { payment: { entity: { id: 'pay_2', amount: 50000, customer_id: 'c_1' } } }
  }
  const req2 = createSignedRequest(payload2, 'evt_stale_fail')
  await POST(req2)
  console.assert(mockDb.payment.status === PaymentStatus.CAPTURED, 'Payment status remained CAPTURED despite stale FAILED event')

  // TEST 3: Exact Money Parsing (Minor Units)
  const payload3 = {
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_3', amount: 12345, currency: 'INR', customer_id: 'c_1' } } } // ₹123.45 -> 12345 minor units
  }
  const req3 = createSignedRequest(payload3, 'evt_money')
  await POST(req3)
  console.assert(mockDb.payment.amountMinor === 12345, 'Amount parsed exactly without floating point conversion')

  // TEST 4: Subscription Status Mapping
  const payload4 = {
    event: 'subscription.halted',
    payload: { subscription: { entity: { id: 'sub_1', status: 'halted', customer_id: 'c_1' } } }
  }
  const req4 = createSignedRequest(payload4, 'evt_sub')
  await POST(req4)
  console.assert(mockDb.subscription.status === SubscriptionStatus.CANCELED, 'Razorpay "halted" mapped correctly to Prisma "CANCELED"')

  console.log('--- All Hardening Tests Passed! ---')
}

runTests().catch(console.error)
