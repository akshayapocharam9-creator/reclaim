/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { markOpportunityRecovered } from '../../../../../lib/recovery-agent/workflow'
import { getAuthenticatedTenantContext, requireRole } from '../../../../../lib/auth/tenant-context'
import { MembershipRole } from '@prisma/client'

export async function POST(
  request: NextRequest,
  { params }: { params: any }
) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }

    const roleCheck = requireRole(auth, [MembershipRole.OWNER, MembershipRole.ADMIN])
    if (!roleCheck.allowed) {
      return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.statusCode })
    }

    const tenantId = auth.tenantId
    const { id } = await Promise.resolve(params)

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      // Body optional
    }

    const result = await markOpportunityRecovered({
      tenantId,
      opportunityId: id,
      recoveredAmountMinor: body.recoveredAmountMinor,
      notes: body.notes
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.statusCode || 400 })
    }

    return NextResponse.json({
      message: result.isIdempotent ? 'Opportunity already recovered' : 'Opportunity marked as recovered',
      opportunity: result.opportunity,
      action: result.action,
      isIdempotent: result.isIdempotent || false
    }, { status: 200 })
  } catch (error) {
    console.error('[API_RECOVER_OPPORTUNITY_ERROR]', error)
    return NextResponse.json({ error: 'Failed to mark opportunity recovered' }, { status: 500 })
  }
}
