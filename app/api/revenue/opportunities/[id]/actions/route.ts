/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { executeRecoveryAction, getOpportunityActionState } from '../../../../../lib/recovery-agent/workflow'
import { getAuthenticatedTenantContext, requireRole } from '../../../../../lib/auth/tenant-context'
import { MembershipRole } from '@prisma/client'

export async function GET(
  request: NextRequest,
  { params }: { params: any }
) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }
    const tenantId = auth.tenantId
    const { id } = await Promise.resolve(params)

    const state = await getOpportunityActionState({ tenantId, opportunityId: id })

    if (!state) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    return NextResponse.json(state)
  } catch (error) {
    console.error('[API_GET_ACTIONS_ERROR]', error)
    return NextResponse.json({ error: 'Failed to retrieve opportunity actions' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: any }
) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }

    // Enforce role permission: Only OWNER and ADMIN can take recovery actions
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
      // Body is optional; fallback to default recommendation
    }

    const result = await executeRecoveryAction({
      tenantId,
      opportunityId: id,
      actionType: body.actionType,
      channel: body.channel,
      notes: body.notes
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.statusCode || 400 })
    }

    return NextResponse.json({
      message: result.isIdempotent ? 'Action already active (idempotent)' : 'Action initiated successfully',
      action: result.action,
      opportunity: result.opportunity,
      isIdempotent: result.isIdempotent || false
    }, { status: result.isIdempotent ? 200 : 201 })
  } catch (error) {
    console.error('[API_POST_ACTIONS_ERROR]', error)
    return NextResponse.json({ error: 'Failed to execute recovery action' }, { status: 500 })
  }
}
