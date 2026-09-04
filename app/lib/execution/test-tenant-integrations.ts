/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from '../prisma'
import { createSessionToken } from '../auth/session'
import { MembershipRole } from '@prisma/client'
import { GET as getIntegrations } from '../../api/revenue/integrations/route'
import { GET as getWebhooks } from '../../api/revenue/webhooks/route'
import { GET as getPolicies, PUT as putPolicies } from '../../api/revenue/policies/route'
import { POST as postWebhook } from '../../api/webhooks/razorpay/route'
import crypto from 'crypto'
import assert from 'assert'
import { NextRequest } from 'next/server'

function createMockRequest(url: string, method: string = 'GET', token?: string, body?: any): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  }
  if (token) {
    headers['cookie'] = `reclaim_session=${token}`
  }
  return new NextRequest(new URL(url, 'https://reclaim-tau-eight.vercel.app'), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })
}

async function runTests() {
  console.log('=== TESTING REAL TENANT INTEGRATIONS, WEBHOOK LOGS, & DB POLICIES ===\n')

  // Setup test tenants and users
  const tenantA = await prisma.tenant.upsert({
    where: { slug: 'test-integ-tenant-a' },
    update: {},
    create: { name: 'Integration Tenant A', slug: 'test-integ-tenant-a' }
  })

  const tenantB = await prisma.tenant.upsert({
    where: { slug: 'test-integ-tenant-b' },
    update: {},
    create: { name: 'Integration Tenant B', slug: 'test-integ-tenant-b' }
  })

  const userOwnerA = await prisma.user.upsert({
    where: { email: 'owner.a@integtest.com' },
    update: {},
    create: { email: 'owner.a@integtest.com', name: 'Owner A' }
  })

  const userMemberA = await prisma.user.upsert({
    where: { email: 'member.a@integtest.com' },
    update: {},
    create: { email: 'member.a@integtest.com', name: 'Member A' }
  })

  const userOwnerB = await prisma.user.upsert({
    where: { email: 'owner.b@integtest.com' },
    update: {},
    create: { email: 'owner.b@integtest.com', name: 'Owner B' }
  })

  // Ensure memberships
  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: userOwnerA.id, tenantId: tenantA.id } },
    update: { role: MembershipRole.OWNER },
    create: { userId: userOwnerA.id, tenantId: tenantA.id, role: MembershipRole.OWNER }
  })

  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: userMemberA.id, tenantId: tenantA.id } },
    update: { role: MembershipRole.MEMBER },
    create: { userId: userMemberA.id, tenantId: tenantA.id, role: MembershipRole.MEMBER }
  })

  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: userOwnerB.id, tenantId: tenantB.id } },
    update: { role: MembershipRole.OWNER },
    create: { userId: userOwnerB.id, tenantId: tenantB.id, role: MembershipRole.OWNER }
  })

  const tokenOwnerA = createSessionToken({ userId: userOwnerA.id, email: userOwnerA.email, tenantId: tenantA.id, role: MembershipRole.OWNER })
  const tokenMemberA = createSessionToken({ userId: userMemberA.id, email: userMemberA.email, tenantId: tenantA.id, role: MembershipRole.MEMBER })
  const tokenOwnerB = createSessionToken({ userId: userOwnerB.id, email: userOwnerB.email, tenantId: tenantB.id, role: MembershipRole.OWNER })

  // --- 1. /api/revenue/integrations Authentication & Payload ---
  console.log('--- 1. Testing /api/revenue/integrations ---')
  const unauthInteg = await getIntegrations(createMockRequest('/api/revenue/integrations', 'GET'))
  assert.strictEqual(unauthInteg.status, 401, 'Unauthenticated request must be rejected with 401')
  console.log('✅ PASS: Unauthenticated /api/revenue/integrations rejected with 401')

  const authInteg = await getIntegrations(createMockRequest('/api/revenue/integrations', 'GET', tokenOwnerA))
  assert.strictEqual(authInteg.status, 200, 'Authenticated request must succeed with 200')
  const integData = await authInteg.json()
  assert.strictEqual(integData.success, true)
  assert.strictEqual(integData.tenantId, tenantA.id)
  assert.ok(integData.webhookEndpoint.includes('/api/webhooks/razorpay'), 'Webhook endpoint must be present')
  assert.ok(integData.integrations.length >= 3, 'Must return Razorpay, Resend, and Gemini providers')
  console.log('✅ PASS: Authenticated /api/revenue/integrations returned valid tenant providers')

  // --- 2. Database RecoveryPolicy GET & PUT Persistence ---
  console.log('\n--- 2. Testing RecoveryPolicy DB Persistence & RBAC ---')
  const getPolicyRes = await getPolicies(createMockRequest('/api/revenue/policies', 'GET', tokenOwnerA))
  assert.strictEqual(getPolicyRes.status, 200)
  const policyData = await getPolicyRes.json()
  assert.ok(policyData.activePolicy.id, 'Active policy must exist in DB')
  const initialVersion = policyData.activePolicy.version
  console.log(`✅ PASS: Active policy loaded from DB (version: ${initialVersion})`)

  // Member role attempting to mutate policy -> must fail with 403
  const memberMutateRes = await putPolicies(createMockRequest('/api/revenue/policies', 'PUT', tokenMemberA, {
    policyId: policyData.activePolicy.id,
    maxAmountMinor: 500000
  }))
  assert.strictEqual(memberMutateRes.status, 403, 'Member mutation must be rejected with 403')
  console.log('✅ PASS: MEMBER role mutation rejected with 403')

  // Owner mutating policy -> must succeed and increment version
  const ownerMutateRes = await putPolicies(createMockRequest('/api/revenue/policies', 'PUT', tokenOwnerA, {
    policyId: policyData.activePolicy.id,
    maxAmountMinor: 750000,
    cooldownSeconds: 7200,
    autoExecutionEnabled: true
  }))
  assert.strictEqual(ownerMutateRes.status, 200)
  const updatedPolicyData = await ownerMutateRes.json()
  assert.strictEqual(updatedPolicyData.policy.version, initialVersion + 1, 'Policy version must increment')
  assert.strictEqual(updatedPolicyData.policy.maxAmountMinor, 750000, 'maxAmountMinor must be updated in DB')
  assert.strictEqual(updatedPolicyData.policy.cooldownSeconds, 7200, 'cooldownSeconds must be updated in DB')
  console.log(`✅ PASS: OWNER updated policy in DB successfully (new version: ${updatedPolicyData.policy.version})`)

  // --- 3. Webhook Ingestion & Tenant Isolation in /api/revenue/webhooks ---
  console.log('\n--- 3. Testing Webhook Events & Tenant Isolation ---')
  // Send a webhook event for Tenant A
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'reclaim-secure-webhook-secret-2026'
  const eventIdA = `evt_test_tenantA_${Date.now()}`
  const webhookBodyA = {
    id: eventIdA,
    event_id: eventIdA,
    entity: 'event',
    account_id: 'acc_test_tenantA',
    event: 'payment.failed',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: `pay_test_a_${Date.now()}`,
          amount: 150000,
          currency: 'INR',
          status: 'failed',
          order_id: `order_test_a_${Date.now()}`,
          email: 'customer.a@example.com',
          contact: '+919999999999',
          error_code: 'BAD_REQUEST_ERROR',
          error_description: 'Payment declined',
          created_at: Math.floor(Date.now() / 1000)
        }
      }
    },
    created_at: Math.floor(Date.now() / 1000)
  }

  const rawBody = JSON.stringify(webhookBodyA)
  const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  const webhookReq = new NextRequest(`https://reclaim-tau-eight.vercel.app/api/webhooks/razorpay?tenantId=${tenantA.id}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': signature,
      'x-razorpay-event-id': eventIdA,
      'x-tenant-id': tenantA.id
    },
    body: rawBody
  })

  const webhookRes = await postWebhook(webhookReq)
  assert.strictEqual(webhookRes.status, 200, 'Webhook ingestion must return 200')
  console.log('✅ PASS: Webhook ingested successfully for Tenant A')

  // Check Tenant A's webhook logs
  const webhooksLogResA = await getWebhooks(createMockRequest('/api/revenue/webhooks', 'GET', tokenOwnerA))
  assert.strictEqual(webhooksLogResA.status, 200)
  const webhooksDataA = await webhooksLogResA.json()
  assert.ok(webhooksDataA.events.some((e: any) => e.eventId === eventIdA), 'Tenant A must see their ingested event')
  console.log('✅ PASS: Tenant A sees their ingested webhook event in log')

  // Check Tenant B's webhook logs -> must NOT see Tenant A's event!
  const webhooksLogResB = await getWebhooks(createMockRequest('/api/revenue/webhooks', 'GET', tokenOwnerB))
  assert.strictEqual(webhooksLogResB.status, 200)
  const webhooksDataB = await webhooksLogResB.json()
  assert.ok(!webhooksDataB.events.some((e: any) => e.eventId === eventIdA), 'Tenant B must NOT see Tenant A event')
  console.log('✅ PASS: Tenant B isolated — cannot see Tenant A webhook events')

  // Cleanup test data
  console.log('\n--- 4. Cleaning up test data ---')
  await prisma.webhookEvent.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } })
  await prisma.recoveryOpportunity.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } })
  await prisma.recoveryPolicy.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } })
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } })
  await prisma.membership.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } })
  await prisma.user.deleteMany({ where: { id: { in: [userOwnerA.id, userMemberA.id, userOwnerB.id] } } })
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } })
  console.log('✅ PASS: Test data cleaned completely from Supabase PostgreSQL')

  console.log('\n==================================================')
  console.log('🎉 ALL INTEGRATIONS, WEBHOOK LOGS, & POLICY TESTS PASSED!')
  console.log('==================================================')
}

runTests().catch(err => {
  console.error('FATAL TEST ERROR:', err)
  process.exit(1)
})
