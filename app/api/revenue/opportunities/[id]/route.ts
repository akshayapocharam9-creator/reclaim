import { NextRequest, NextResponse } from 'next/server'
import prisma from '../../../../lib/prisma'
import { getAuthenticatedTenantContext } from '../../../../lib/auth/tenant-context'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }
    const tenantId = auth.tenantId

    const { id } = await params

    const opportunity = await prisma.recoveryOpportunity.findUnique({
      where: {
        id,
        tenantId // Strictly scope to tenant
      },
      include: {
        customer: true,
        payment: true,
        checkoutSession: true,
        subscription: true
      }
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Not Found', message: 'Opportunity not found' }, { status: 404 })
    }

    return NextResponse.json({ opportunity }, { status: 200 })

  } catch (error) {
    console.error('[API_OPPORTUNITY_DETAIL_ERROR]', error)
    return NextResponse.json({ error: 'Internal Server Error', message: 'An unexpected error occurred' }, { status: 500 })
  }
}
