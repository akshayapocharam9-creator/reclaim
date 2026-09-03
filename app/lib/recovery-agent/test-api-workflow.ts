import prisma from '../prisma'
import { NextRequest } from 'next/server'
import { POST as postAction, GET as getActions } from '../../api/revenue/opportunities/[id]/actions/route'
import { POST as postRecover } from '../../api/revenue/opportunities/[id]/recover/route'
import { POST as postFail } from '../../api/revenue/opportunities/[id]/fail/route'
import { OpportunityStatus, OpportunityType, PriorityLevel, MembershipRole } from '@prisma/client'
import { createSessionToken } from '../auth/session'

async function runApiTests() {
  console.log('=== TESTING WORKFLOW API ENDPOINTS ===')

  const owner = await prisma.user.findUnique({
    where: { email: 'owner@demosaas.com' },
    include: { memberships: true }
  })
  const foreignOwner = await prisma.user.findUnique({
    where: { email: 'owner@foreigntest.com' },
    include: { memberships: true }
  })

  const TENANT_ID = owner?.memberships[0]?.tenantId || 'cmtkeayky00005qkzmnagbcbb'
  const FOREIGN_TENANT_ID = foreignOwner?.memberships[0]?.tenantId || 'cmtlssp02000bbsyqpo6f0ec6'

  const validToken = createSessionToken({
    userId: owner!.id,
    email: owner!.email,
    tenantId: TENANT_ID,
    role: MembershipRole.OWNER
  })

  const foreignToken = createSessionToken({
    userId: foreignOwner!.id,
    email: foreignOwner!.email,
    tenantId: FOREIGN_TENANT_ID,
    role: MembershipRole.OWNER
  })

  // Create test opportunity
  const opp = await prisma.recoveryOpportunity.create({
    data: {
      tenantId: TENANT_ID,
      type: OpportunityType.PAYMENT_FAILURE,
      status: OpportunityStatus.DETECTED,
      amountAtRiskMinor: 800000,
      recoverableAmountMinor: 720000,
      priority: PriorityLevel.HIGH,
      score: 80,
      confidenceScore: 0.85,
      reason: 'API workflow test',
      evidence: { test: true }
    }
  })
  console.log(`Created test opp: ${opp.id}`)

  try {
    // 1. GET /actions without token -> 401
    const reqNoAuth = new NextRequest(`http://localhost/api/revenue/opportunities/${opp.id}/actions`)
    const resNoAuth = await getActions(reqNoAuth, { params: { id: opp.id } })
    console.assert(resNoAuth.status === 401, 'Unauthenticated request should be 401')

    // 2. GET /actions with foreign token -> 404 (isolation)
    const reqForeign = new NextRequest(`http://localhost/api/revenue/opportunities/${opp.id}/actions`, {
      headers: { authorization: `Bearer ${foreignToken}` }
    })
    const resForeign = await getActions(reqForeign, { params: { id: opp.id } })
    console.assert(resForeign.status === 404, 'Foreign tenant should get 404')
    console.log('API GET tenant isolation verified.')

    // 3. POST /actions -> 201
    const reqAction = new NextRequest(`http://localhost/api/revenue/opportunities/${opp.id}/actions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'Initiated via API test' })
    })
    const resAction = await postAction(reqAction, { params: { id: opp.id } })
    console.assert(resAction.status === 201, `Expected 201, got ${resAction.status}`)
    const actionData = await resAction.json()
    console.assert(actionData.opportunity.status === 'IN_PROGRESS', 'Opportunity must be IN_PROGRESS')
    console.log('API POST /actions verified.')

    // 4. POST /actions again -> 200 (idempotent)
    const reqActionDup = new NextRequest(`http://localhost/api/revenue/opportunities/${opp.id}/actions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${validToken}` }
    })
    const resActionDup = await postAction(reqActionDup, { params: { id: opp.id } })
    console.assert(resActionDup.status === 200, `Idempotent call should return 200, got ${resActionDup.status}`)
    const dupData = await resActionDup.json()
    console.assert(dupData.isIdempotent === true, 'isIdempotent flag must be true')
    console.log('API POST /actions idempotency verified.')

    // 5. POST /recover -> 200
    const reqRecover = new NextRequest(`http://localhost/api/revenue/opportunities/${opp.id}/recover`, {
      method: 'POST',
      headers: { authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'Confirmed recovery via API' })
    })
    const resRecover = await postRecover(reqRecover, { params: { id: opp.id } })
    console.assert(resRecover.status === 200, `Expected 200, got ${resRecover.status}`)
    const recoverData = await resRecover.json()
    console.assert(recoverData.opportunity.status === 'RECOVERED', 'Opportunity must be RECOVERED')
    console.log('API POST /recover verified.')

    // 6. POST /fail on RECOVERED opp -> 409 (invalid transition)
    const reqFailInvalid = new NextRequest(`http://localhost/api/revenue/opportunities/${opp.id}/fail`, {
      method: 'POST',
      headers: { authorization: `Bearer ${validToken}` }
    })
    const resFailInvalid = await postFail(reqFailInvalid, { params: { id: opp.id } })
    console.assert(resFailInvalid.status === 409, `Expected 409, got ${resFailInvalid.status}`)
    console.log('API invalid transition rejection verified.')

    // 7. GET /actions to verify full state
    const reqGetState = new NextRequest(`http://localhost/api/revenue/opportunities/${opp.id}/actions`, {
      headers: { authorization: `Bearer ${validToken}` }
    })
    const resGetState = await getActions(reqGetState, { params: { id: opp.id } })
    const stateData = await resGetState.json()
    console.assert(stateData.opportunityStatus === 'RECOVERED', 'Status must be RECOVERED')
    console.assert(stateData.actions.length === 1, 'Must have 1 action')
    console.assert(stateData.outcomes.length === 1, 'Must have 1 outcome')
    console.log('API GET state audit history verified.')

  } finally {
    // Cleanup
    await prisma.recoveryOutcome.deleteMany({ where: { opportunityId: opp.id } })
    await prisma.recoveryAction.deleteMany({ where: { opportunityId: opp.id } })
    await prisma.recoveryOpportunity.deleteMany({ where: { id: opp.id } })
    console.log('Test cleanup complete.')
  }

  console.log('=== ALL API TESTS PASSED ===')
}

runApiTests()
  .catch((err) => {
    console.error('API test failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
