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
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    cadenceId: result.cadenceId
  })
}
