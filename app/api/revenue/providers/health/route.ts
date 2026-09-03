import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedTenantContext } from '../../../../lib/auth/tenant-context'
import { providerHealthMonitor } from '../../../../lib/execution/health'
import { validateEnvironment } from '../../../../lib/env'

/**
 * GET /api/revenue/providers/health
 * Returns operational health, metrics, and circuit breaker statuses for all recovery providers.
 * Strictly requires authenticated user session.
 */
export async function GET(request: NextRequest) {
  const tenantContext = await getAuthenticatedTenantContext(request)
  if (!tenantContext) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const env = validateEnvironment()
  const stats = providerHealthMonitor.getAllStats({
    RAZORPAY_PAYMENT_PROVIDER: env.razorpayConfigured,
    RESEND_EMAIL_PROVIDER: env.resendConfigured,
    SIMULATION_PROVIDER: true
  })

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    executionMode: env.executionMode,
    providers: stats
  }, { status: 200 })
}
