/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedTenantContext } from '../../../../lib/auth/tenant-context'
import { simulatePolicyAmount } from '../../../../lib/policy/service'

/**
 * GET /api/revenue/policies/simulate?amount=...
 * 
 * STRICT ARCHITECTURAL INVARIANTS:
 * - Read-only operation.
 * - ZERO database mutations (no insert, update, or delete).
 * - ZERO external Razorpay API or payment gateway calls.
 * - ZERO recovery actions or executions dispatched.
 * - Invokes the authoritative deterministic policy engine.
 * - AI is strictly decoupled and never influences the decision.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }

    const { searchParams } = new URL(request.url)
    const amountParam = searchParams.get('amount')
    const amountINR = amountParam ? parseFloat(amountParam) : 7500

    if (isNaN(amountINR) || amountINR < 0) {
      return NextResponse.json(
        { error: 'Invalid amount parameter. Must be a non-negative number.' },
        { status: 400 }
      )
    }

    // Convert to minor units (paise)
    const amountMinor = Math.round(amountINR * 100)

    const result = await simulatePolicyAmount({
      tenantId: auth.tenantId,
      amountMinor
    })

    return NextResponse.json(result, { status: 200 })
  } catch (err: any) {
    console.error('[POLICY_SIMULATE_ERROR]', err)
    return NextResponse.json(
      { error: err.message || 'Failed to simulate policy evaluation' },
      { status: 500 }
    )
  }
}
