import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedTenantContext } from '../../../../lib/auth/tenant-context'
import { scheduleDunningCadence } from '../../../../lib/recovery/dunning-cadence-service'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthenticatedTenantContext(request)
  if (!auth.success) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Only OWNER or ADMIN can manually trigger/schedule cadences
  if (auth.role !== 'OWNER' && auth.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Insufficient permissions to schedule cadence' }, { status: 403 })
  }

  const result = await scheduleDunningCadence(auth.tenantId, id, {
    email: auth.user.email || 'unknown'
  })

  if (!result.success) {
    const status =
      result.error === 'Opportunity not found'
        ? 404
        : result.error?.includes('Cannot schedule') || result.error?.includes('already exists')
          ? 409
          : 400
    return NextResponse.json({ error: result.error }, { status })
  }

  return NextResponse.json({
    success: true,
    cadenceId: result.cadenceId
  })
}
