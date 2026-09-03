/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedTenantContext, requireRole } from '../../../../../lib/auth/tenant-context'
import { retryExecution } from '../../../../../lib/execution/service'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/revenue/executions/[id]/retry
 * Retries a failed recovery execution.
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

    const { id: executionId } = await context.params
    const body = await request.json().catch(() => ({}))
    const allowReviewRetry = Boolean(body?.allowReviewRetry)

    const result = await retryExecution(
      executionId,
      auth.tenantId,
      { id: auth.user.id, email: auth.user.email, role: auth.role },
      { allowReviewRetry }
    )

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.statusCode })
    }

    return NextResponse.json({
      message: 'Execution retried successfully',
      execution: result.execution,
      result: result.result
    }, { status: 200 })
  } catch (err: any) {
    console.error('Error retrying execution:', err)
    return NextResponse.json({ error: 'Internal server error retrying execution' }, { status: 500 })
  }
}
