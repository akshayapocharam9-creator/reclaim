/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { claimNextQueuedExecution, recoverStaleExecutions } from '../../../lib/execution/processor'
import { processExecution } from '../../../lib/execution/service'
import { getAuthenticatedTenantContext } from '../../../lib/auth/tenant-context'
import { StructuredLogger } from '../../../lib/observability/logger'

/**
 * Background Worker Endpoint: GET /api/cron/worker & POST /api/cron/worker
 * Processes queued executions in bounded batches and recovers stale in-flight jobs.
 * Protected by CRON_SECRET or authenticated ADMIN/OWNER session.
 */
async function handleWorkerRun(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  let authorized = false
  let tenantIdFilter: string | undefined

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    authorized = true
  } else {
    // Check if an authenticated ADMIN or OWNER triggered the worker
    const auth = await getAuthenticatedTenantContext(request)
    if (auth.success && (auth.role === 'OWNER' || auth.role === 'ADMIN')) {
      authorized = true
      tenantIdFilter = auth.tenantId
    } else if (process.env.NODE_ENV !== 'production' && !cronSecret) {
      // In non-production local development without CRON_SECRET configured, permit invocation
      authorized = true
    }
  }

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized worker invocation' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '10', 10), 1), 25)

  // 1. Recover stale executions first
  const staleRecovery = await recoverStaleExecutions({
    tenantId: tenantIdFilter,
    staleThresholdMinutes: 5
  })

  // 2. Process queued executions up to bounded limit
  let claimedCount = 0
  let succeededCount = 0
  let failedCount = 0
  const processedExecutions: Array<{ id: string; status: string; tenantId: string }> = []

  for (let i = 0; i < limit; i++) {
    const workerId = `cron_worker_${Date.now()}_${i}`
    const claimResult = await claimNextQueuedExecution({
      tenantId: tenantIdFilter,
      workerId
    })

    if (!claimResult.claimed || !claimResult.execution) {
      // Queue is empty
      break
    }

    claimedCount++
    const exec = claimResult.execution

    try {
      const execResult = await processExecution(exec.id, exec.tenantId, {
        email: workerId,
        role: 'ADMIN'
      })

      if (execResult.success && execResult.execution?.status === 'SUCCEEDED') {
        succeededCount++
      } else {
        failedCount++
      }

      processedExecutions.push({
        id: exec.id,
        status: execResult.execution?.status || 'UNKNOWN',
        tenantId: exec.tenantId
      })

    } catch {
      failedCount++
      processedExecutions.push({
        id: exec.id,
        status: 'FAILED',
        tenantId: exec.tenantId
      })
    }
  }

  StructuredLogger.info('WORKER_BATCH_PROCESSED', {
    tenantId: tenantIdFilter,
    provider: 'SYSTEM_WORKER'
  }, {
    claimedCount,
    succeededCount,
    failedCount,
    staleRecoveredCount: staleRecovery.recoveredCount
  })

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    batchLimit: limit,
    claimedCount,
    succeededCount,
    failedCount,
    staleRecoveredCount: staleRecovery.recoveredCount,
    processedExecutions
  }, { status: 200 })
}

export async function GET(request: NextRequest) {
  return handleWorkerRun(request)
}

export async function POST(request: NextRequest) {
  return handleWorkerRun(request)
}
