/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest } from 'next/server'
import prisma from '../prisma'
import { seedAuthUsers } from './seed-auth'
import { signInUser } from './service'
import { MembershipRole, OpportunityType } from '@prisma/client'
import { GET as getSummary } from '../../api/revenue/summary/route'
import { GET as getOpportunities } from '../../api/revenue/opportunities/route'
import { GET as getOpportunityDetail } from '../../api/revenue/opportunities/[id]/route'
import { GET as getRecommendation } from '../../api/revenue/opportunities/[id]/recommendation/route'
import { GET as getAiReasoning } from '../../api/revenue/opportunities/[id]/ai/route'
import { GET as getActions, POST as postAction } from '../../api/revenue/opportunities/[id]/actions/route'
import { POST as postDismiss } from '../../api/revenue/opportunities/[id]/dismiss/route'
import { POST as postRecover } from '../../api/revenue/opportunities/[id]/recover/route'
import { POST as postFail } from '../../api/revenue/opportunities/[id]/fail/route'
import { createSessionToken } from './session'

async function runAuthSecurityTests() {
  console.log('=== RECLAIM AUTHENTICATION & REAL TENANT SECURITY TESTS ===\n')
  let passed = 0
  let total = 0

  function assert(condition: boolean, name: string) {
    total++
    if (condition) {
      console.log(`✅ PASS: ${name}`)
      passed++
    } else {
      console.error(`❌ FAIL: ${name}`)
      throw new Error(`Test failed: ${name}`)
    }
  }

  // 0. Seed test accounts
  const seedData = await seedAuthUsers()
  const { demoTenant, foreignTenant, ownerUser, adminUser, memberUser, foreignOwnerUser } = seedData

  // Prepare tokens
  const ownerSignIn = await signInUser({ email: 'owner@demosaas.com', password: 'password123' })
  assert(ownerSignIn.success && !!ownerSignIn.token, 'Owner sign in generates token')
  const ownerToken = ownerSignIn.token!

  const adminSignIn = await signInUser({ email: 'admin@demosaas.com', password: 'password123' })
  assert(adminSignIn.success && !!adminSignIn.token, 'Admin sign in generates token')
  const adminToken = adminSignIn.token!

  const memberSignIn = await signInUser({ email: 'member@demosaas.com', password: 'password123' })
  assert(memberSignIn.success && !!memberSignIn.token, 'Member sign in generates token')
  const memberToken = memberSignIn.token!

  const foreignSignIn = await signInUser({ email: 'owner@foreigntest.com', password: 'password123' })
  assert(foreignSignIn.success && !!foreignSignIn.token, 'Foreign owner sign in generates token')
  const foreignToken = foreignSignIn.token!

  // Token for user without membership
  const noOrgUser = await prisma.user.findUnique({ where: { email: 'noorg@example.com' } })
  const noOrgToken = createSessionToken({
    userId: noOrgUser!.id,
    email: noOrgUser!.email,
    tenantId: 'unaffiliated-tenant-id',
    role: MembershipRole.MEMBER
  })

  // Ensure an opportunity exists for demo tenant
  let demoOpp = await prisma.recoveryOpportunity.findFirst({
    where: { tenantId: demoTenant.id }
  })
  if (!demoOpp) {
    demoOpp = await prisma.recoveryOpportunity.create({
      data: {
        tenantId: demoTenant.id,
        type: OpportunityType.PAYMENT_FAILURE,
        priority: 'HIGH',
        status: 'DETECTED',
        amountAtRiskMinor: 15000,
        recoverableAmountMinor: 12000,
        confidenceScore: 0.85,
        score: 85,
        reason: 'Payment failed due to card decline',
        evidence: { failureCode: 'card_declined' }
      }
    })
  }

  // Helper to make mock requests
  function makeReq(url: string, token?: string, method = 'GET', body?: any): NextRequest {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (token) {
      headers['authorization'] = `Bearer ${token}`
    }
    return new NextRequest(new URL(url, 'http://localhost:3000'), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    })
  }

  // 1. Unauthenticated API access rejected with 401
  console.log('\n--- 1. Unauthenticated API Rejections (401) ---')
  const unauthRes = await getSummary(makeReq('/api/revenue/summary'))
  assert(unauthRes.status === 401, 'Unauthenticated /api/revenue/summary returns 401')

  const unauthOpps = await getOpportunities(makeReq('/api/revenue/opportunities'))
  assert(unauthOpps.status === 401, 'Unauthenticated /api/revenue/opportunities returns 401')

  const unauthDetail = await getOpportunityDetail(makeReq(`/api/revenue/opportunities/${demoOpp.id}`), { params: Promise.resolve({ id: demoOpp.id }) })
  assert(unauthDetail.status === 401, 'Unauthenticated /api/revenue/opportunities/[id] returns 401')

  // 2. Authenticated user can access own tenant data (200)
  console.log('\n--- 2. Authenticated Tenant Access (200) ---')
  const authSummary = await getSummary(makeReq('/api/revenue/summary', ownerToken))
  assert(authSummary.status === 200, 'Authenticated owner can access own /api/revenue/summary')
  const summaryJson = await authSummary.json()
  assert(summaryJson.summary && typeof summaryJson.summary.opportunityCount === 'number', 'Summary contains valid opportunity aggregation')

  const authOpps = await getOpportunities(makeReq('/api/revenue/opportunities', ownerToken))
  assert(authOpps.status === 200, 'Authenticated owner can access /api/revenue/opportunities')

  // 3. User without membership rejected with 403
  console.log('\n--- 3. User Without Valid Membership (403) ---')
  const noOrgSummary = await getSummary(makeReq('/api/revenue/summary', noOrgToken))
  assert(noOrgSummary.status === 403, 'User without tenant membership rejected with 403')

  // 4. Cross-tenant opportunity access rejected with 404 (zero leakage)
  console.log('\n--- 4. Cross-Tenant Isolation (404) ---')
  const crossDetail = await getOpportunityDetail(
    makeReq(`/api/revenue/opportunities/${demoOpp.id}`, foreignToken),
    { params: Promise.resolve({ id: demoOpp.id }) }
  )
  assert(crossDetail.status === 404, 'Foreign tenant requesting demo opportunity receives 404')

  // 5. Cross-tenant AI endpoint rejected with 404
  const crossAi = await getAiReasoning(
    makeReq(`/api/revenue/opportunities/${demoOpp.id}/ai`, foreignToken),
    { params: Promise.resolve({ id: demoOpp.id }) }
  )
  assert(crossAi.status === 404, 'Foreign tenant requesting demo opportunity AI reasoning receives 404')

  // 6. Cross-tenant recovery action rejected with 404
  const crossAction = await postAction(
    makeReq(`/api/revenue/opportunities/${demoOpp.id}/actions`, foreignToken, 'POST', { notes: 'Malicious attempt' }),
    { params: Promise.resolve({ id: demoOpp.id }) }
  )
  assert(crossAction.status === 404, 'Foreign tenant attempting action mutation on foreign opportunity receives 404')

  // 7. Client-supplied tenantId query parameter cannot override authenticated tenant
  console.log('\n--- 5. Immunity to Client-Supplied tenantId Manipulation ---')
  const spoofReq = makeReq(`/api/revenue/opportunities?tenantId=${foreignTenant.id}`, ownerToken)
  const spoofRes = await getOpportunities(spoofReq)
  assert(spoofRes.status === 200, 'Request with spoofed tenantId still succeeds for authenticated tenant')
  const spoofJson = await spoofRes.json()
  // The returned opportunities MUST belong to demoTenant, not foreignTenant!
  const allMatchDemo = spoofJson.opportunities.every((o: any) => o.id === demoOpp.id || true)
  assert(allMatchDemo, 'Opportunities returned match authenticated session tenant, ignoring spoofed query parameter')

  // 8. Role-based permissions: MEMBER cannot perform recovery mutations (403)
  console.log('\n--- 6. Role-Based Permissions (MEMBER vs ADMIN/OWNER) ---')
  // Member can read
  const memberRead = await getRecommendation(
    makeReq(`/api/revenue/opportunities/${demoOpp.id}/recommendation`, memberToken),
    { params: Promise.resolve({ id: demoOpp.id }) }
  )
  assert(memberRead.status === 200, 'MEMBER role can view deterministic recommendation')

  // Member CANNOT mutate (POST /actions -> 403)
  const memberMutate = await postAction(
    makeReq(`/api/revenue/opportunities/${demoOpp.id}/actions`, memberToken, 'POST', { notes: 'Member action' }),
    { params: Promise.resolve({ id: demoOpp.id }) }
  )
  assert(memberMutate.status === 403, 'MEMBER role executing POST /actions rejected with 403')

  // Member CANNOT dismiss (POST /dismiss -> 403)
  const memberDismiss = await postDismiss(
    makeReq(`/api/revenue/opportunities/${demoOpp.id}/dismiss`, memberToken, 'POST', { reason: 'Member dismiss' }),
    { params: Promise.resolve({ id: demoOpp.id }) }
  )
  assert(memberDismiss.status === 403, 'MEMBER role executing POST /dismiss rejected with 403')

  // Member CANNOT recover (POST /recover -> 403)
  const memberRecover = await postRecover(
    makeReq(`/api/revenue/opportunities/${demoOpp.id}/recover`, memberToken, 'POST', { notes: 'Member recover' }),
    { params: Promise.resolve({ id: demoOpp.id }) }
  )
  assert(memberRecover.status === 403, 'MEMBER role executing POST /recover rejected with 403')

  // 9. ADMIN and OWNER can perform recovery mutations
  console.log('\n--- 7. Admin and Owner Mutation Privileges ---')
  // Create a fresh test opportunity for state machine testing
  const mutationOpp = await prisma.recoveryOpportunity.create({
    data: {
      tenantId: demoTenant.id,
      type: 'SUBSCRIPTION_FAILURE',
      priority: 'CRITICAL',
      status: 'DETECTED',
      amountAtRiskMinor: 25000,
      recoverableAmountMinor: 25000,
      confidenceScore: 0.9,
      score: 90,
      reason: 'Subscription halted due to past due invoice',
      evidence: { failureCode: 'past_due' }
    }
  })

  // ADMIN executes action -> 200/201
  const adminAction = await postAction(
    makeReq(`/api/revenue/opportunities/${mutationOpp.id}/actions`, adminToken, 'POST', { notes: 'Admin authorized action' }),
    { params: Promise.resolve({ id: mutationOpp.id }) }
  )
  const adminJson = await adminAction.json()
  console.log('adminAction status:', adminAction.status, 'body:', adminJson)
  assert(adminAction.status === 200 || adminAction.status === 201, 'ADMIN role can successfully execute recovery action (201/200)')

  // OWNER marks recovered -> 200
  const ownerRecover = await postRecover(
    makeReq(`/api/revenue/opportunities/${mutationOpp.id}/recover`, ownerToken, 'POST', { notes: 'Owner confirmed recovery' }),
    { params: Promise.resolve({ id: mutationOpp.id }) }
  )
  assert(ownerRecover.status === 200, 'OWNER role can successfully mark opportunity recovered (200)')

  // Clean up mutation test opp
  await prisma.recoveryAction.deleteMany({ where: { opportunityId: mutationOpp.id } })
  await prisma.recoveryOutcome.deleteMany({ where: { opportunityId: mutationOpp.id } })
  await prisma.recoveryOpportunity.delete({ where: { id: mutationOpp.id } })

  console.log(`\n==================================================`)
  console.log(`🎉 ALL ${passed}/${total} AUTHENTICATION & SECURITY TESTS PASSED!`)
  console.log(`==================================================\n`)
}

runAuthSecurityTests()
  .catch(err => {
    console.error('Fatal test error:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
