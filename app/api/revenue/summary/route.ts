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

    const opportunities = await prisma.recoveryOpportunity.findMany({
      where: { tenantId },
      select: {
        amountAtRiskMinor: true,
        recoverableAmountMinor: true,
        type: true,
        priority: true
      }
    })

    const totalAmountAtRiskMinor = opportunities.reduce((acc, o) => acc + o.amountAtRiskMinor, 0)
    const totalEstimatedRecoverableAmountMinor = opportunities.reduce((acc, o) => acc + o.recoverableAmountMinor, 0)
    
    const countsByType: Record<string, number> = {}
    const countsByPriority: Record<string, number> = {}

    for (const opp of opportunities) {
      countsByType[opp.type] = (countsByType[opp.type] || 0) + 1
      countsByPriority[opp.priority] = (countsByPriority[opp.priority] || 0) + 1
    }

    return NextResponse.json({
      summary: {
        totalAmountAtRiskMinor,
        totalEstimatedRecoverableAmountMinor,
        opportunityCount: opportunities.length,
        countsByType,
        countsByPriority
      }
    }, { status: 200 })

  } catch (error) {
    console.error('[API_REVENUE_SUMMARY_ERROR]', error)
    return NextResponse.json({ error: 'Internal Server Error', message: 'An unexpected error occurred' }, { status: 500 })
  }
}
