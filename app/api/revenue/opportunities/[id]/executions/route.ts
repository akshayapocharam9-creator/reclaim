/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '../../../../../lib/prisma'
import { getAuthenticatedTenantContext, requireRole } from '../../../../../lib/auth/tenant-context'
import { queueExecution, processExecution } from '../../../../../lib/execution/service'
import { checkRateLimit } from '../../../../../lib/auth/rate-limiter'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/revenue/opportunities/[id]/executions
 * Queues and executes a recovery action.
 * Strictly requires OWNER or ADMIN role.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }

    const roleCheck = requireRole(auth, ['OWNER', 'ADMIN'])
    if (!roleCheck.allowed) {
      return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.statusCode })
    }

    const rateLimit = await checkRateLimit({
      tenantId: auth.tenantId,
      eventType: 'EXECUTION_STARTED',
      maxRequests: 30,
      windowSeconds: 60
    })
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Execution rate limit exceeded. Please wait.' }, { status: 429 })
    }

    const { id: opportunityId } = await context.params

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      // Empty body is acceptable; defaults will be resolved
    }

    // Resolve actionId: from body or latest action on opportunity
    let actionId = body.actionId
    if (!actionId) {
      const latestAction = await prisma.recoveryAction.findFirst({
        where: { opportunityId, tenantId: auth.tenantId },
        orderBy: { createdAt: 'desc' }
      })
      if (!latestAction) {
        return NextResponse.json(
          { error: 'No recovery action found for this opportunity. Please create an action before executing.' },
          { status: 404 }
        )
      }
      actionId = latestAction.id
    }

    // Queue execution with database-level idempotency
    const queueResult = await queueExecution({
      tenantId: auth.tenantId,
      opportunityId,
      actionId,
      idempotencyKey: body.idempotencyKey,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      messageSubject: body.messageSubject,
      messageBody: body.messageBody,
      metadata: body.metadata
    })

    if (!queueResult.success) {
      return NextResponse.json({ error: queueResult.error }, { status: queueResult.statusCode })
    }

    // If idempotent repeat of existing non-queued execution, return it directly
    if (queueResult.isIdempotent && queueResult.execution.status !== 'QUEUED') {
      return NextResponse.json(
        {
          message: 'Execution already processed for this idempotency key',
          execution: queueResult.execution,
          isIdempotent: true
        },
        { status: 200 }
      )
    }

    // Process the execution
    const processResult = await processExecution(
      queueResult.execution.id,
      auth.tenantId,
      { id: auth.user.id, email: auth.user.email, role: auth.role }
    )

    return NextResponse.json(
      {
        message: processResult.success ? 'Execution completed successfully' : 'Execution failed',
        execution: processResult.execution,
        result: processResult.result,
        isIdempotent: queueResult.isIdempotent ?? false
      },
      { status: queueResult.isIdempotent ? 200 : (processResult.success ? 201 : 422) }
    )
  } catch (err: any) {
    console.error('Error executing recovery action:', err)
    return NextResponse.json({ error: 'Internal server error executing action' }, { status: 500 })
  }
}

/**
 * GET /api/revenue/opportunities/[id]/executions
 * Retrieves all executions for an opportunity.
 * Scoped strictly to session tenant.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }

    const { id: opportunityId } = await context.params

    // Verify opportunity exists and belongs to authenticated tenant
    const opportunity = await prisma.recoveryOpportunity.findUnique({
      where: { id: opportunityId, tenantId: auth.tenantId }
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    const executions = await prisma.recoveryExecution.findMany({
      where: { opportunityId, tenantId: auth.tenantId },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({
      opportunityId,
      count: executions.length,
      executions
    })
  } catch (err: any) {
    console.error('Error fetching executions:', err)
    return NextResponse.json({ error: 'Internal server error fetching executions' }, { status: 500 })
  }
}
