/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '../../../lib/prisma'
import { getAuthenticatedTenantContext } from '../../../lib/auth/tenant-context'

/**
 * GET /api/revenue/audit
 * Returns recent tenant audit events for activity tracking and audit trail.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50)

    const auditEvents = await prisma.auditEvent.findMany({
      where: { tenantId: auth.tenantId },
      orderBy: { timestamp: 'desc' },
      take: limit
    })

    return NextResponse.json({
      count: auditEvents.length,
      auditEvents
    })
  } catch (err: any) {
    console.error('Error fetching audit events:', err)
    return NextResponse.json({ error: 'Internal server error fetching audit events' }, { status: 500 })
  }
}
