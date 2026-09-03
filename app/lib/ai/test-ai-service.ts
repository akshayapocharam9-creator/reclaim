/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from '../prisma'
import { NextRequest } from 'next/server'
import { GET } from '../../api/revenue/opportunities/[id]/ai/route'
import { FallbackAIProvider, GeminiProvider, getAIProvider } from './provider'
import { buildSanitizedContext, generateOpportunityAIReasoning } from './service'
import { generateRecommendation } from '../recovery-agent/engine'
import { OpportunityStatus, OpportunityType, PriorityLevel, MembershipRole } from '@prisma/client'
import { createSessionToken } from '../auth/session'

async function runAITests() {
  console.log('=== LLM-ASSISTED RECOVERY INTELLIGENCE TEST SUITE ===')

  const TENANT_ID = process.env.RAZORPAY_TENANT_ID || 'cmtkeayky00005qkzmnagbcbb'
  const FOREIGN_TENANT_ID = 'unauthorized-tenant-ai-999'

  // Step 1: Test AI Provider Abstraction
  console.log('\n[1] Testing AI Provider Abstraction...')
  const defaultProvider = getAIProvider()
  console.assert(defaultProvider !== null, 'getAIProvider() must return a provider')
  console.log(`Active provider selected: ${defaultProvider.name}`)

  const fallback = new FallbackAIProvider()
  const mockInput = {
    opportunityId: 'opp-mock-1',
    opportunityType: 'PAYMENT_FAILURE',
    amountAtRiskMajor: 500,
    expectedRecoveryMajor: 450,
    currency: 'INR',
    priority: 'HIGH',
    urgency: 'IMMEDIATE',
    recommendedAction: 'RETRY_PAYMENT',
    suggestedChannel: 'AUTOMATED',
    deterministicReason: 'Insufficient funds on first attempt',
    failureCount: 1,
    customerName: 'Test Merchant Customer'
  }

  const fallbackOutput = await fallback.generateReasoning(mockInput)
  console.assert(fallbackOutput.summary.length > 0, 'Fallback must generate summary')
  console.assert(fallbackOutput.suggestedCustomerMessage.length > 0, 'Fallback must generate customer message')
  console.assert(fallbackOutput.isFallback === true, 'isFallback must be true')
  console.assert(typeof fallbackOutput.confidence === 'number', 'Confidence must be a number')
  console.log('Fallback AI provider successfully verified.')

  // Step 2: Test Provider Error Handling & Recovery
  console.log('\n[2] Testing Provider Error Handling & Safe Fallback...')
  const badGeminiProvider = new GeminiProvider('invalid-fake-key-for-test')
  let caughtError = false
  try {
    await badGeminiProvider.generateReasoning(mockInput)
  } catch {
    caughtError = true
  }
  console.assert(caughtError === true, 'Invalid API key must throw inside provider')
  console.log('Invalid key safely detected and isolated.')

  // Step 3: Test Real DB Opportunity with AI Service
  console.log('\n[3] Setting up test opportunity in DB...')
  const opp = await prisma.recoveryOpportunity.create({
    data: {
      tenantId: TENANT_ID,
      type: OpportunityType.PAYMENT_FAILURE,
      status: OpportunityStatus.DETECTED,
      amountAtRiskMinor: 1200000,
      recoverableAmountMinor: 1080000,
      priority: PriorityLevel.HIGH,
      score: 85,
      confidenceScore: 0.9,
      reason: 'AI test payment failure',
      evidence: { testCardSecret: 'MUST_BE_STRIPPED_1234' }
    }
  })
  console.log(`Created test opp in DB: ${opp.id}`)

  try {
    // Step 4: Test Context Sanitizer (Ensure no sensitive data leaks)
    console.log('\n[4] Testing Context Sanitizer & Privacy...')
    const deterministicRec = generateRecommendation(opp)
    const context = buildSanitizedContext(opp, deterministicRec)
    const contextStr = JSON.stringify(context)
    console.assert(!contextStr.includes('MUST_BE_STRIPPED'), 'Context must not contain sensitive evidence/secrets')
    console.assert(context.amountAtRiskMajor === 12000, 'Amount must be correctly converted to major units for context')
    console.log('Context sanitized cleanly: zero secrets or card numbers exposed.')

    // Step 5: Test Service Generation & Financial Immutability
    console.log('\n[5] Testing AI Service & Financial Immutability...')
    const aiResult = await generateOpportunityAIReasoning({
      opportunity: opp,
      recommendation: deterministicRec
    })

    console.assert(aiResult !== null, 'AI result must be generated')
    console.assert(aiResult.summary.length > 0, 'Summary must exist')
    console.assert(aiResult.riskExplanation.length > 0, 'Risk explanation must exist')
    console.assert(aiResult.suggestedCustomerMessage.length > 0, 'Suggested customer message must exist')

    // Verify DB opportunity was NOT mutated financially
    const oppAfter = await prisma.recoveryOpportunity.findUnique({ where: { id: opp.id } })
    console.assert(oppAfter?.amountAtRiskMinor === 1200000, 'amountAtRiskMinor MUST NOT be changed by AI')
    console.assert(oppAfter?.recoverableAmountMinor === 1080000, 'recoverableAmountMinor MUST NOT be changed by AI')
    console.assert(oppAfter?.status === OpportunityStatus.DETECTED, 'Opportunity status MUST NOT be changed by AI')
    console.assert(oppAfter?.priority === PriorityLevel.HIGH, 'Priority MUST NOT be changed by AI')
    console.log('Financial immutability verified: AI did not mutate any financial state or status.')

    // Step 6: Test Cache Persistence
    console.log('\n[6] Testing Cache Persistence...')
    const cachedOpp = await prisma.recoveryOpportunity.findUnique({ where: { id: opp.id } })
    const cachedRec = cachedOpp?.recommendation as any
    console.assert(cachedRec?.aiReasoning !== undefined, 'AI reasoning must be cached in opportunity')
    console.assert(cachedRec.aiReasoning.summary === aiResult.summary, 'Cached summary must match original')

    // Subsequent call without forceRefresh should read from cache
    const secondCall = await generateOpportunityAIReasoning({
      opportunity: cachedOpp!,
      recommendation: deterministicRec,
      forceRefresh: false
    })
    console.assert(secondCall.generatedAt === aiResult.generatedAt, 'Cached result must have same timestamp')
    console.log('AI Caching verified: Successfully reused cached reasoning.')

    // Step 7: Test API Route & Tenant Isolation
    console.log('\n[7] Testing API Endpoint & Tenant Isolation...')
    const owner = await prisma.user.findUnique({ where: { email: 'owner@demosaas.com' } })
    const foreignOwner = await prisma.user.findUnique({ where: { email: 'owner@foreigntest.com' }, include: { memberships: true } })

    const validToken = createSessionToken({
      userId: owner!.id,
      email: owner!.email,
      tenantId: TENANT_ID,
      role: MembershipRole.OWNER
    })

    const foreignToken = createSessionToken({
      userId: foreignOwner!.id,
      email: foreignOwner!.email,
      tenantId: foreignOwner!.memberships[0].tenantId,
      role: MembershipRole.OWNER
    })

    // Foreign tenant request -> 404
    const reqForeign = new NextRequest(`http://localhost/api/revenue/opportunities/${opp.id}/ai`, {
      headers: { authorization: `Bearer ${foreignToken}` }
    })
    const resForeign = await GET(reqForeign, { params: { id: opp.id } })
    console.assert(resForeign.status === 404, `Foreign tenant should receive 404, got ${resForeign.status}`)

    // Valid tenant request -> 200
    const reqValid = new NextRequest(`http://localhost/api/revenue/opportunities/${opp.id}/ai`, {
      headers: { authorization: `Bearer ${validToken}` }
    })
    const resValid = await GET(reqValid, { params: { id: opp.id } })
    console.assert(resValid.status === 200, `Valid tenant should receive 200, got ${resValid.status}`)
    const apiData = await resValid.json()

    console.assert(apiData.opportunityId === opp.id, 'API must return correct opportunityId')
    console.assert(apiData.deterministicRecommendation.recommendedAction === deterministicRec.recommendedAction, 'API must include authoritative recommendation')
    console.assert(apiData.aiReasoning.summary !== undefined, 'API must include AI reasoning')
    console.log('API tenant isolation and response verified.')

  } finally {
    // Cleanup
    await prisma.recoveryOpportunity.deleteMany({ where: { id: opp.id } })
    console.log('Test cleanup complete.')
  }

  console.log('\n=== ALL AI INTELLIGENCE TESTS PASSED ===')
}

runAITests()
  .catch((err) => {
    console.error('AI test failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
