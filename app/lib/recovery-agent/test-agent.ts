import prisma from '../prisma'
import { generateRecommendation } from './engine'
import { RecoveryAction, RecoveryPriority, RecoveryChannel } from './types'
import { NextRequest } from 'next/server'
import { GET } from '../../api/revenue/opportunities/[id]/recommendation/route'
import { createSessionToken } from '../auth/session'
import { MembershipRole } from '@prisma/client'

async function runTests() {
  console.log('=== TESTING RECOVERY AGENT ===')

  // Find an existing opportunity in the DB
  const opportunities = await prisma.recoveryOpportunity.findMany({
    take: 5
  })

  if (opportunities.length === 0) {
    console.log('No opportunities found in DB. Run the local webhook simulator first.')
    return
  }

  for (const opp of opportunities) {
    console.log(`\n--- Testing Opportunity: ${opp.id} (${opp.type}) ---`)
    const recommendation = generateRecommendation(opp)

    console.log(`Action: ${recommendation.recommendedAction}`)
    console.log(`Priority: ${recommendation.priority}`)
    console.log(`Urgency: ${recommendation.urgency}`)
    console.log(`Channel: ${recommendation.suggestedChannel}`)
    console.log(`Reason: ${recommendation.reason}`)
    console.log(`Expected Recovery Minor: ${recommendation.expectedRecoveryAmountMinor}`)

    // Basic assertions
    if (!Object.values(RecoveryAction).includes(recommendation.recommendedAction)) {
      throw new Error('Invalid Recovery Action')
    }
    if (!Object.values(RecoveryPriority).includes(recommendation.priority)) {
      throw new Error('Invalid Recovery Priority')
    }
    if (recommendation.expectedRecoveryAmountMinor !== opp.recoverableAmountMinor) {
      throw new Error('Recovery amount mismatch')
    }

    // High value check
    if (opp.amountAtRiskMinor > 1000000) {
      if (recommendation.priority === RecoveryPriority.LOW || recommendation.priority === RecoveryPriority.MEDIUM) {
        throw new Error('High value opportunity should have HIGH or CRITICAL priority')
      }
    }

    // Repeated failure check
    if (opp.type === 'REPEATED_PAYMENT_FAILURE' && recommendation.recommendedAction !== RecoveryAction.CONTACT_CUSTOMER) {
      throw new Error('Repeated failure should escalate to contact customer')
    }

    console.log('Deterministic rules check passed.')

    console.log('\n--- Testing API Route ---')
    // We mock the Request object with authenticated session token
    const owner = await prisma.user.findUnique({ where: { email: 'owner@demosaas.com' } })
    const token = createSessionToken({
      userId: owner ? owner.id : 'fallback-id',
      email: 'owner@demosaas.com',
      tenantId: opp.tenantId,
      role: MembershipRole.OWNER
    })
    const req = new NextRequest(`http://localhost/api/revenue/opportunities/${opp.id}/recommendation`, {
      headers: { authorization: `Bearer ${token}` }
    })
    const res = await GET(req, { params: { id: opp.id } })
    const data = await res.json()

    if (res.status !== 200) {
      throw new Error(`API returned ${res.status}: ${JSON.stringify(data)}`)
    }

    if (data.recommendedAction !== recommendation.recommendedAction) {
      throw new Error('API response mismatch')
    }

    console.log('API tenant isolation and response passed.')
  }

  console.log('\n=== ALL TESTS PASSED ===')
}

runTests()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect()
  })
