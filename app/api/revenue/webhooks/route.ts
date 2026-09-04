/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '../../../lib/prisma'
import { getAuthenticatedTenantContext } from '../../../lib/auth/tenant-context'

export const dynamic = 'force-dynamic'

/**
 * GET /api/revenue/webhooks
 * Returns real, persisted webhook events received for the authenticated tenant.
 * Includes delivery status, event type, timestamps, and linked outcomes.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10), 1), 100)
    const eventTypeFilter = searchParams.get('eventType')

    const where: any = {
      tenantId: auth.tenantId
    }

    if (eventTypeFilter && eventTypeFilter !== 'all') {
      where.eventType = eventTypeFilter
    }

    const [events, total] = await Promise.all([
      prisma.webhookEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          outcomes: {
            select: {
              id: true,
              type: true,
              recoveredAmountMinor: true,
              occurredAt: true
            }
          }
        }
      }),
      prisma.webhookEvent.count({ where })
    ])

    // Format and sanitize events
    const sanitizedEvents = events.map(e => {
      const payloadObj: any = typeof e.payload === 'object' && e.payload !== null ? e.payload : {}
      
      // Extract safe summary from payload without exposing customer PII/card details
      const entity = payloadObj.payload?.payment?.entity || payloadObj.payload?.order?.entity || {}
      const summary = {
        amountMinor: entity.amount || 0,
        currency: entity.currency || 'INR',
        status: entity.status || 'unknown',
        method: entity.method || undefined,
        errorCode: entity.error_code || undefined,
        errorDescription: entity.error_description || undefined
      }

      return {
        id: e.id,
        provider: e.provider,
        eventId: e.eventId,
        eventType: e.eventType,
        summary,
        outcomesCount: e.outcomes.length,
        outcomes: e.outcomes,
        processedAt: e.processedAt ? e.processedAt.toISOString() : null,
        createdAt: e.createdAt.toISOString()
      }
    })

    return NextResponse.json({
      success: true,
      total,
      limit,
      events: sanitizedEvents
    }, { status: 200 })

  } catch (err: any) {
    console.error('Error fetching tenant webhooks:', err)
    return NextResponse.json({ error: 'Internal server error fetching webhook events' }, { status: 500 })
  }
}
