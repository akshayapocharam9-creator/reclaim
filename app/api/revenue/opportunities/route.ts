import { NextRequest, NextResponse } from 'next/server'
import prisma from '../../../lib/prisma'
import { getAuthenticatedTenantContext } from '../../../lib/auth/tenant-context'

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }
    const tenantId = auth.tenantId

    // 1. Fetch persisted intelligence scoped to tenant
    // Include customer to hydrate the UI requirements
    const opportunities = await prisma.recoveryOpportunity.findMany({
      where: { tenantId },
      include: {
        customer: {
          select: { name: true }
        }
      },
      orderBy: { score: 'desc' }
    })

    // 2. Map to the shape expected by the frontend Dashboard
    const mappedOpportunities = opportunities.map(opp => ({
      id: opp.id,
      eventId: opp.id, // Stable unique reference for UI
      customerName: opp.customer?.name || 'Unknown Customer',
      amount: opp.amountAtRiskMinor / 100, // Convert to major units for frontend
      priority: opp.priority,
      analysis: {
        problem: opp.type,
        financialImpact: opp.recoverableAmountMinor / 100,
        reasoning: opp.reason,
        recoveryProbability: opp.confidenceScore || 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recommendedAction: (opp.recommendation as any)?.action || 'Review Internally'
      },
      status: opp.status ? (opp.status === 'DETECTED' ? 'pending' : opp.status.toLowerCase()) : 'pending',
      createdAt: opp.createdAt ? (typeof opp.createdAt === 'string' ? opp.createdAt : opp.createdAt.toISOString()) : new Date().toISOString()
    }))

    // 3. Construct summary aggregation
    const totalAmountAtRiskMinor = opportunities.reduce((acc, o) => acc + o.amountAtRiskMinor, 0)
    const totalEstimatedRecoverableAmountMinor = opportunities.reduce((acc, o) => acc + o.recoverableAmountMinor, 0)
    
    const countsByType: Record<string, number> = {}
    const countsByPriority: Record<string, number> = {}

    for (const opp of opportunities) {
      countsByType[opp.type] = (countsByType[opp.type] || 0) + 1
      countsByPriority[opp.priority] = (countsByPriority[opp.priority] || 0) + 1
    }

    return NextResponse.json({
      opportunities: mappedOpportunities,
      summary: {
        totalAmountAtRiskMinor,
        totalEstimatedRecoverableAmountMinor,
        opportunityCount: opportunities.length,
        countsByType,
        countsByPriority
      }
    }, { status: 200 })

  } catch (error) {
    console.error('[API_REVENUE_OPPORTUNITIES_ERROR]', error)
    return NextResponse.json({ error: 'Internal Server Error', message: 'An unexpected error occurred' }, { status: 500 })
  }
}
