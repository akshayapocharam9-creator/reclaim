/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '../../../../lib/prisma'
import { getAuthenticatedTenantContext } from '../../../../lib/auth/tenant-context'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/revenue/executions/[id]
 * Retrieves details of a specific execution.
 * Scoped strictly to session tenant.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }

    const { id: executionId } = await context.params

    const execution = await prisma.recoveryExecution.findUnique({
      where: { id: executionId },
      include: {
        opportunity: {
          select: {
            id: true,
            status: true,
            amountAtRiskMinor: true,
            recoverableAmountMinor: true,
            type: true,
            priority: true
          }
        },
        recoveryAction: {
          select: {
            id: true,
            type: true,
            status: true,
            channel: true,
            notes: true
          }
        }
      }
    })

    if (!execution || execution.tenantId !== auth.tenantId) {
      return NextResponse.json({ error: 'Execution record not found' }, { status: 404 })
    }

    return NextResponse.json({ execution })
  } catch (err: any) {
    console.error('Error fetching execution record:', err)
    return NextResponse.json({ error: 'Internal server error fetching execution record' }, { status: 500 })
  }
}
