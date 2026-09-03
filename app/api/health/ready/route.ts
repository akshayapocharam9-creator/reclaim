/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import prisma from '../../../lib/prisma'
import { validateEnvironment } from '../../../lib/env'
import { providerHealthMonitor } from '../../../lib/execution/health'

export const dynamic = 'force-dynamic'

export async function GET() {
  const envValidation = validateEnvironment()

  // 1. Check Database Connectivity
  let dbStatus = 'connected'
  let dbLatencyMs = 0
  const dbStart = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    dbLatencyMs = Date.now() - dbStart
  } catch (err: any) {
    dbStatus = 'disconnected'
    dbLatencyMs = Date.now() - dbStart
    return NextResponse.json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      reason: 'DATABASE_UNREACHABLE',
      database: { status: dbStatus, error: err.message },
      environment: {
        env: envValidation.environment,
        mode: envValidation.executionMode
      }
    }, { status: 503 })
  }

  // 2. Check Provider Health Statuses
  const providerStats = providerHealthMonitor.getAllStats({
    RAZORPAY_PAYMENT_PROVIDER: envValidation.razorpayConfigured,
    RESEND_EMAIL_PROVIDER: envValidation.resendConfigured,
    SIMULATION_PROVIDER: true
  })

  const isReady = dbStatus === 'connected' && envValidation.valid

  return NextResponse.json({
    status: isReady ? 'ready' : 'degraded',
    timestamp: new Date().toISOString(),
    database: {
      status: dbStatus,
      latencyMs: dbLatencyMs
    },
    environment: {
      env: envValidation.environment,
      mode: envValidation.executionMode,
      valid: envValidation.valid,
      missingVars: envValidation.missingRequiredVars,
      warnings: envValidation.warnings
    },
    providers: providerStats.map(p => ({
      provider: p.providerName,
      status: p.status,
      successRate: `${p.successRate}%`,
      avgLatencyMs: p.averageLatencyMs
    }))
  }, { status: isReady ? 200 : 200 })
}
