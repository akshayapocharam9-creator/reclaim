import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedTenantContext } from '../../../../lib/auth/tenant-context'
import { getExecutionObservability } from '../../../../lib/execution/processor'

/**
 * GET /api/revenue/executions/observability
 * Returns real database-backed operational execution metrics for the authenticated tenant.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }

    const metrics = await getExecutionObservability(auth.tenantId)

    return NextResponse.json(metrics, { status: 200 })
  } catch (err) {
    console.error('Error fetching execution observability:', err)
    return NextResponse.json({ error: 'Internal server error fetching observability metrics' }, { status: 500 })
  }
}
