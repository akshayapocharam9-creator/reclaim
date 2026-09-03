/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '../../../lib/prisma'
import { getAuthenticatedTenantContext, requireRole } from '../../../lib/auth/tenant-context'
import { getOrCreateDefaultTenantPolicy, updateTenantPolicy } from '../../../lib/policy/service'

/**
 * GET /api/revenue/policies
 * Returns active tenant policies (default policy and specific overrides).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }

    const defaultPolicy = await getOrCreateDefaultTenantPolicy(auth.tenantId)
    const allPolicies = await prisma.recoveryPolicy.findMany({
      where: { tenantId: auth.tenantId },
      orderBy: { createdAt: 'asc' }
    })

    return NextResponse.json({
      activePolicy: defaultPolicy,
      policies: allPolicies
    }, { status: 200 })

  } catch (err: any) {
    console.error('Error fetching policies:', err)
    return NextResponse.json({ error: 'Internal server error fetching policies' }, { status: 500 })
  }
}

/**
 * PUT /api/revenue/policies
 * Updates tenant policy settings.
 * Strictly requires OWNER or ADMIN role.
 */
export async function PUT(request: NextRequest) {
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
    const { policyId, ...updates } = body

    const updated = await updateTenantPolicy({
      tenantId: auth.tenantId,
      policyId,
      updates,
      actorEmail: auth.user.email
    })

    return NextResponse.json({
      success: true,
      message: 'Recovery policy updated successfully',
      policy: updated
    }, { status: 200 })

  } catch (err: any) {
    console.error('Error updating recovery policy:', err)
    return NextResponse.json({ error: err.message || 'Internal server error updating policy' }, { status: 500 })
  }
}
