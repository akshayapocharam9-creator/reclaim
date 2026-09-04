/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '../../../lib/prisma'
import { getAuthenticatedTenantContext } from '../../../lib/auth/tenant-context'
import { providerHealthMonitor } from '../../../lib/execution/health'
import { validateEnvironment } from '../../../lib/env'

export const dynamic = 'force-dynamic'

/**
 * GET /api/revenue/integrations
 * Returns real, tenant-specific integration statuses, provider health,
 * and live webhook registration configurations.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }

    const origin = request.headers.get('x-forwarded-host')
      ? `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('x-forwarded-host')}`
      : process.env.NEXT_PUBLIC_APP_URL || 'https://reclaim-tau-eight.vercel.app'

    const webhookEndpoint = `${origin}/api/webhooks/razorpay?tenantId=${auth.tenantId}`

    // Live provider health
    const env = validateEnvironment()
    const healthSummaries = providerHealthMonitor.getAllStats({
      RAZORPAY_PAYMENT_PROVIDER: env.razorpayConfigured,
      RESEND_EMAIL_PROVIDER: env.resendConfigured,
      SIMULATION_PROVIDER: true
    })
    const razorpayHealth = healthSummaries.find(p => p.providerName === 'RAZORPAY_PAYMENT_PROVIDER')
    const resendHealth = healthSummaries.find(p => p.providerName === 'RESEND_EMAIL_PROVIDER')
    const simulationHealth = healthSummaries.find(p => p.providerName === 'SIMULATION_PROVIDER')

    // Webhook stats for this tenant from database
    const [totalWebhooks, lastWebhook] = await Promise.all([
      prisma.webhookEvent.count({ where: { tenantId: auth.tenantId } }),
      prisma.webhookEvent.findFirst({
        where: { tenantId: auth.tenantId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, eventType: true, eventId: true }
      })
    ])

    const webhookSecretConfigured = Boolean(
      process.env.RAZORPAY_WEBHOOK_SECRET &&
      process.env.RAZORPAY_WEBHOOK_SECRET !== 'reclaim-secure-webhook-secret-2026'
    )

    const executionMode = process.env.RECOVERY_EXECUTION_MODE || 'audit'

    const integrations = [
      {
        id: 'razorpay',
        name: 'Razorpay',
        category: 'Payment Gateway',
        status: razorpayHealth ? razorpayHealth.status : 'UNCONFIGURED',
        isConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
        webhookUrl: webhookEndpoint,
        webhookSecretConfigured,
        supportedEvents: [
          'payment.failed',
          'payment.captured',
          'order.paid',
          'subscription.halted',
          'subscription.charged'
        ],
        totalEventsReceived: totalWebhooks,
        lastEventAt: lastWebhook?.createdAt ? lastWebhook.createdAt.toISOString() : null,
        lastEventType: lastWebhook?.eventType || null,
        executionMode,
        description: 'Ingests real payment failures, charges, and subscription lifecycle events via HMAC-verified webhooks.'
      },
      {
        id: 'resend',
        name: 'Resend',
        category: 'Customer Communications',
        status: resendHealth ? resendHealth.status : 'UNCONFIGURED',
        isConfigured: Boolean(process.env.RESEND_API_KEY),
        channel: 'EMAIL',
        description: 'Dispatches automated smart dunning notices and payment recovery links to customers.'
      },
      {
        id: 'gemini_ai',
        name: 'Google Gemini AI',
        category: 'Intelligence & Decisioning',
        status: process.env.GEMINI_API_KEY ? 'HEALTHY' : 'FALLBACK_ACTIVE',
        isConfigured: Boolean(process.env.GEMINI_API_KEY),
        description: 'Analyzes churn risk and generates contextual recovery strategies with automatic deterministic fallback.'
      },
      {
        id: 'simulation',
        name: 'Recovery Test Engine',
        category: 'Developer Sandbox',
        status: simulationHealth ? simulationHealth.status : 'HEALTHY',
        isConfigured: true,
        description: 'Safe deterministic testing engine for simulated payment retry and multi-channel validation.'
      }
    ]

    return NextResponse.json({
      success: true,
      tenantId: auth.tenantId,
      webhookEndpoint,
      integrations
    }, { status: 200 })

  } catch (err: any) {
    console.error('Error fetching tenant integrations:', err)
    return NextResponse.json({ error: 'Internal server error fetching integrations' }, { status: 500 })
  }
}
