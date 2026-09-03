/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '../../../../../lib/prisma'
import { generateRecommendation } from '../../../../../lib/recovery-agent/engine'
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
    const { id } = await Promise.resolve(params);

    // 1. Fetch Opportunity strictly enforcing tenant isolation
    const opportunity = await prisma.recoveryOpportunity.findUnique({
      where: {
        id,
        tenantId
      }
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    // 2. Generate Deterministic Recommendation
    const recommendation = generateRecommendation(opportunity)

    return NextResponse.json(recommendation)

  } catch (error) {
    console.error('[API_REVENUE_RECOMMENDATION_ERROR]', error)
    return NextResponse.json({ error: 'Failed to generate recommendation' }, { status: 500 })
  }
}
