/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '../../../lib/prisma'
import { getAuthenticatedTenantContext } from '../../../lib/auth/tenant-context'
import { OpportunityStatus, PriorityLevel, OpportunityType, ActionType, ExecutionStatus, Prisma } from '@prisma/client'

/**
 * GET /api/revenue/queue
 * Server-side filtered, sorted, and paginated work queue for recovery operations.
 * Strictly isolated to the authenticated session tenant.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }

    const { searchParams } = new URL(request.url)

    // Pagination
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '10', 10)))
    const skip = (page - 1) * pageSize

    // Filters
    const status = searchParams.get('status') as OpportunityStatus | null
    const priority = searchParams.get('priority') as PriorityLevel | null
    const type = searchParams.get('type') as OpportunityType | null
    const actionType = searchParams.get('actionType') as ActionType | null
    const executionStatus = searchParams.get('executionStatus') as ExecutionStatus | null
    const provider = searchParams.get('provider')
    const search = searchParams.get('search')?.trim()
    const minAmount = searchParams.get('minAmount') ? parseInt(searchParams.get('minAmount')!, 10) : undefined
    const maxAmount = searchParams.get('maxAmount') ? parseInt(searchParams.get('maxAmount')!, 10) : undefined

    // Sorting
    const sortBy = searchParams.get('sortBy') || 'detectedAt'
    const sortOrder = searchParams.get('sortOrder')?.toLowerCase() === 'asc' ? 'asc' : 'desc'

    // Build Prisma where clause
    const where: Prisma.RecoveryOpportunityWhereInput = {
      tenantId: auth.tenantId
    }

    if (status && Object.values(OpportunityStatus).includes(status)) {
      where.status = status
    }

    if (priority && Object.values(PriorityLevel).includes(priority)) {
      where.priority = priority
    }

    if (type && Object.values(OpportunityType).includes(type)) {
      where.type = type
    }

    if (minAmount !== undefined || maxAmount !== undefined) {
      where.amountAtRiskMinor = {}
      if (minAmount !== undefined) where.amountAtRiskMinor.gte = minAmount
      if (maxAmount !== undefined) where.amountAtRiskMinor.lte = maxAmount
    }

    if (search) {
      where.OR = [
        { reason: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { email: { contains: search, mode: 'insensitive' } } }
      ]
    }

    if (actionType || provider) {
      where.actions = {
        some: {
          ...(actionType ? { type: actionType } : {}),
          ...(provider ? { channel: provider } : {})
        }
      }
    }

    if (executionStatus) {
      where.executions = {
        some: {
          status: executionStatus
        }
      }
    }

    // Determine sorting order
    const orderBy: Prisma.RecoveryOpportunityOrderByWithRelationInput = {}
    if (sortBy === 'amountAtRiskMinor' || sortBy === 'recoverableAmountMinor' || sortBy === 'createdAt' || sortBy === 'detectedAt') {
      orderBy[sortBy] = sortOrder
    } else {
      orderBy.detectedAt = 'desc'
    }

    // Fetch data and total count concurrently
    const [total, opportunities] = await Promise.all([
      prisma.recoveryOpportunity.count({ where }),
      prisma.recoveryOpportunity.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: {
          customer: {
            select: { id: true, name: true, email: true }
          },
          actions: {
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          executions: {
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          outcomes: {
            orderBy: { occurredAt: 'desc' },
            take: 1
          }
        }
      })
    ])

    const totalPages = Math.ceil(total / pageSize)

    return NextResponse.json({
      opportunities: opportunities.map(opp => ({
        id: opp.id,
        tenantId: opp.tenantId,
        type: opp.type,
        status: opp.status,
        amountAtRiskMinor: opp.amountAtRiskMinor,
        recoverableAmountMinor: opp.recoverableAmountMinor,
        priority: opp.priority,
        score: opp.score,
        reason: opp.reason,
        detectedAt: opp.detectedAt,
        resolvedAt: opp.resolvedAt,
        customer: opp.customer,
        latestAction: opp.actions[0] || null,
        latestExecution: opp.executions[0] || null,
        latestOutcome: opp.outcomes[0] || null
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasMore: page < totalPages
      }
    }, { status: 200 })
  } catch (err: any) {
    console.error('Error fetching recovery work queue:', err)
    return NextResponse.json({ error: 'Internal server error fetching recovery work queue' }, { status: 500 })
  }
}
