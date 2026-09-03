/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from '../prisma'
import { ActionStatus, ExecutionStatus } from '@prisma/client'
import { logAuditEvent } from '../audit/audit-service'

export interface ClaimExecutionResult {
  claimed: boolean
  execution?: any
  message?: string
}

export interface StaleExecutionRecoveryResult {
  recoveredCount: number
  recoveredExecutionIds: string[]
}

/**
 * Atomically claims the next queued execution for a tenant or globally.
 * Protected against race conditions using PostgreSQL conditional atomic updates.
 */
export async function claimNextQueuedExecution(params: {
  tenantId?: string
  workerId?: string
}): Promise<ClaimExecutionResult> {
  const { tenantId, workerId = 'system_worker' } = params

  const candidate = await prisma.recoveryExecution.findFirst({
    where: {
      status: ExecutionStatus.QUEUED,
      ...(tenantId ? { tenantId } : {})
    },
    orderBy: { createdAt: 'asc' }
  })

  if (!candidate) {
    return { claimed: false, message: 'No queued executions found' }
  }

  const now = new Date()

  // Atomic claim: only succeeds if still QUEUED
  const updateResult = await prisma.recoveryExecution.updateMany({
    where: {
      id: candidate.id,
      status: ExecutionStatus.QUEUED
    },
    data: {
      status: ExecutionStatus.RUNNING,
      startedAt: now,
      claimedAt: now,
      claimedBy: workerId,
      heartbeatAt: now
    }
  })

  if (updateResult.count === 0) {
    // Concurrently claimed by another worker; caller can retry or exit
    return { claimed: false, message: 'Execution was concurrently claimed by another worker' }
  }

  const claimedExecution = await prisma.recoveryExecution.findUnique({
    where: { id: candidate.id },
    include: {
      opportunity: { include: { customer: true } },
      recoveryAction: true
    }
  })

  return {
    claimed: true,
    execution: claimedExecution
  }
}

/**
 * Scans for stale executions in RUNNING status that exceed the heartbeat/stale threshold.
 * Safely marks them FAILED without automatic unsafe external replay.
 */
export async function recoverStaleExecutions(params: {
  tenantId?: string
  staleThresholdMinutes?: number
}): Promise<StaleExecutionRecoveryResult> {
  const { tenantId, staleThresholdMinutes = 5 } = params
  const staleThresholdDate = new Date(Date.now() - staleThresholdMinutes * 60 * 1000)

  // Find executions that have been RUNNING with no heartbeat for > threshold
  const staleExecutions = await prisma.recoveryExecution.findMany({
    where: {
      status: ExecutionStatus.RUNNING,
      ...(tenantId ? { tenantId } : {}),
      OR: [
        { heartbeatAt: { lt: staleThresholdDate } },
        { heartbeatAt: null, startedAt: { lt: staleThresholdDate } }
      ]
    }
  })

  const recoveredIds: string[] = []

  for (const exec of staleExecutions) {
    const update = await prisma.recoveryExecution.updateMany({
      where: {
        id: exec.id,
        status: ExecutionStatus.RUNNING
      },
      data: {
        status: ExecutionStatus.FAILED,
        failureReason: `EXECUTION_TIMEOUT: Execution exceeded stale threshold of ${staleThresholdMinutes} minutes without heartbeat.`,
        completedAt: new Date(),
        metadata: {
          ...((exec.metadata as Record<string, unknown>) || {}),
          staleRecoveredAt: new Date().toISOString(),
          isRetryable: exec.attemptCount < exec.maxAttempts
        } as any
      }
    })

    if (update.count > 0) {
      recoveredIds.push(exec.id)

      await logAuditEvent({
        tenantId: exec.tenantId,
        opportunityId: exec.opportunityId,
        eventType: 'EXECUTION_STALE_RECOVERED',
        entityType: 'RecoveryExecution',
        entityId: exec.id,
        metadata: {
          staleThresholdMinutes,
          attemptCount: exec.attemptCount,
          maxAttempts: exec.maxAttempts
        }
      })
    }
  }

  return {
    recoveredCount: recoveredIds.length,
    recoveredExecutionIds: recoveredIds
  }
}

/**
 * Fetches comprehensive, real database-backed execution observability metrics for a tenant.
 */
export async function getExecutionObservability(tenantId: string) {
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000)

  const [
    totalExecutions,
    queuedCount,
    runningCount,
    succeededCount,
    failedCount,
    cancelledCount,
    staleCount,
    pendingApprovalsCount,
    automatedExecutionsCount,
    ambiguousWebhooksCount,
    recentExecutions
  ] = await Promise.all([
    prisma.recoveryExecution.count({ where: { tenantId } }),
    prisma.recoveryExecution.count({ where: { tenantId, status: ExecutionStatus.QUEUED } }),
    prisma.recoveryExecution.count({ where: { tenantId, status: ExecutionStatus.RUNNING } }),
    prisma.recoveryExecution.count({ where: { tenantId, status: ExecutionStatus.SUCCEEDED } }),
    prisma.recoveryExecution.count({ where: { tenantId, status: ExecutionStatus.FAILED } }),
    prisma.recoveryExecution.count({ where: { tenantId, status: ExecutionStatus.CANCELLED } }),
    prisma.recoveryExecution.count({
      where: {
        tenantId,
        status: ExecutionStatus.RUNNING,
        OR: [
          { heartbeatAt: { lt: staleThreshold } },
          { heartbeatAt: null, startedAt: { lt: staleThreshold } }
        ]
      }
    }),
    prisma.recoveryAction.count({ where: { tenantId, status: ActionStatus.PENDING } }),
    prisma.recoveryExecution.count({ where: { tenantId, idempotencyKey: { startsWith: 'auto_' } } }),
    prisma.auditEvent.count({ where: { tenantId, eventType: 'RECOVERY_RECONCILIATION_AMBIGUOUS' } }),
    prisma.recoveryExecution.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        opportunity: { select: { id: true, amountAtRiskMinor: true, priority: true } },
        recoveryAction: { select: { id: true, type: true, channel: true } }
      }
    })
  ])

  // Compute latency (ms) for completed executions
  const completedWithLatency = recentExecutions.filter(e => e.startedAt && e.completedAt)
  const totalLatencyMs = completedWithLatency.reduce((acc, e) => {
    return acc + (e.completedAt!.getTime() - e.startedAt!.getTime())
  }, 0)

  const avgLatencyMs = completedWithLatency.length > 0
    ? Math.round(totalLatencyMs / completedWithLatency.length)
    : 0

  const retriedExecutionsCount = recentExecutions.filter(e => e.attemptCount > 1).length
  const retryRate = totalExecutions > 0 ? Math.round((retriedExecutionsCount / totalExecutions) * 100) : 0
  const completedCount = succeededCount + failedCount
  const successRate = completedCount > 0 ? Math.round((succeededCount / completedCount) * 100) : 100

  const lastSuccessful = recentExecutions.find(e => e.status === ExecutionStatus.SUCCEEDED) || null
  const lastFailed = recentExecutions.find(e => e.status === ExecutionStatus.FAILED) || null

  // Breakdown of failure reasons
  const failureReasons: Record<string, number> = {}
  for (const e of recentExecutions) {
    if (e.failureReason) {
      const simplified = e.failureReason.split(':')[0].trim()
      failureReasons[simplified] = (failureReasons[simplified] || 0) + 1
    }
  }

  return {
    tenantId,
    counts: {
      total: totalExecutions,
      queued: queuedCount,
      running: runningCount,
      succeeded: succeededCount,
      failed: failedCount,
      cancelled: cancelledCount,
      stale: staleCount,
      retried: retriedExecutionsCount,
      pendingApprovals: pendingApprovalsCount,
      automated: automatedExecutionsCount,
      ambiguousWebhooks: ambiguousWebhooksCount
    },
    rates: {
      successRate,
      retryRate
    },
    performance: {
      avgLatencyMs,
      completedSampleCount: completedWithLatency.length
    },
    failureReasons,
    lastSuccessful: lastSuccessful ? {
      id: lastSuccessful.id,
      completedAt: lastSuccessful.completedAt,
      externalReference: lastSuccessful.externalReference,
      provider: lastSuccessful.provider
    } : null,
    lastFailed: lastFailed ? {
      id: lastFailed.id,
      completedAt: lastFailed.completedAt,
      failureReason: lastFailed.failureReason,
      provider: lastFailed.provider
    } : null,
    recentExecutions: recentExecutions.slice(0, 10)
  }
}
