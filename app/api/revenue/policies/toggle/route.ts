/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedTenantContext, requireRole } from '../../../../lib/auth/tenant-context'
import { setTenantAutomationKillSwitch } from '../../../../lib/policy/service'

/**
 * POST /api/revenue/policies/toggle
 * Toggles the tenant-level automation kill switch.
 * Strictly requires OWNER or ADMIN role.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }

    const roleCheck = requireRole(auth, ['OWNER', 'ADMIN'])
    if (!roleCheck.allowed) {
      return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.statusCode })
    }

    const body = await request.json()
    const { enabled } = body

    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'Property "enabled" must be a boolean' }, { status: 400 })
    }

    const policy = await setTenantAutomationKillSwitch({
      tenantId: auth.tenantId,
      enabled,
      actorEmail: auth.user.email
    })

    return NextResponse.json({
      success: true,
      message: enabled ? 'Automatic recovery orchestration enabled' : 'Automation kill switch activated (Auto-execution disabled)',
      autoExecutionEnabled: policy.autoExecutionEnabled
    }, { status: 200 })

  } catch (err: any) {
    console.error('Error toggling automation kill switch:', err)
    return NextResponse.json({ error: 'Internal server error toggling kill switch' }, { status: 500 })
  }
}
