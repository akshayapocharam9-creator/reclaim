import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedTenantContext } from '../../../lib/auth/tenant-context'

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedTenantContext(request)

  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
  }

  return NextResponse.json({
    user: auth.user,
    tenant: auth.tenant,
    role: auth.role
  })
}
