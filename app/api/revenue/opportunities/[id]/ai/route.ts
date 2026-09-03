/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '../../../../../lib/prisma'
import { generateRecommendation } from '../../../../../lib/recovery-agent/engine'
import { generateOpportunityAIReasoning } from '../../../../../lib/ai/service'
import { getAuthenticatedTenantContext } from '../../../../../lib/auth/tenant-context'

export async function GET(
  request: NextRequest,
  { params }: { params: any }
) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }
    const tenantId = auth.tenantId

    const { id } = await Promise.resolve(params)
    const { searchParams } = new URL(request.url)
    const forceRefresh = searchParams.get('refresh') === 'true'

    // 1. Fetch opportunity strictly enforcing tenant isolation
    const opportunity = await prisma.recoveryOpportunity.findUnique({
      where: {
        id,
        tenantId
      },
      include: {
        customer: { select: { name: true } },
        payment: {
          select: {
            attempts: { select: { id: true, attemptNumber: true, failureReason: true } }
          }
        }
      }
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    // 2. Generate Authoritative Deterministic Recommendation
    const deterministicRecommendation = generateRecommendation(opportunity)

    // 3. Generate or retrieve cached AI Reasoning (Advisory only)
    const aiReasoning = await generateOpportunityAIReasoning({
      opportunity,
      recommendation: deterministicRecommendation,
      forceRefresh
    })

    return NextResponse.json({
      opportunityId: opportunity.id,
      deterministicRecommendation: {
        recommendedAction: deterministicRecommendation.recommendedAction,
        priority: deterministicRecommendation.priority,
        urgency: deterministicRecommendation.urgency,
        suggestedChannel: deterministicRecommendation.suggestedChannel,
        expectedRecoveryAmountMinor: deterministicRecommendation.expectedRecoveryAmountMinor
      },
      aiReasoning
    })
  } catch (error) {
    console.error('[API_REVENUE_AI_ERROR]', error)
    return NextResponse.json({ error: 'Failed to generate AI reasoning' }, { status: 500 })
  }
}
