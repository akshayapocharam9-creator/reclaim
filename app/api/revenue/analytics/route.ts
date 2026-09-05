/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '../../../lib/prisma'
import { getAuthenticatedTenantContext } from '../../../lib/auth/tenant-context'
import { ExecutionStatus, OpportunityStatus, OutcomeType } from '@prisma/client'
import { seedTenantShowcaseData } from '../../../lib/tenant/showcase-seed'

/**
 * GET /api/revenue/analytics
 * Returns comprehensive, real database-backed operational and business intelligence
 * strictly isolated to the authenticated user's tenant.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedTenantContext(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.statusCode })
    }

    const { searchParams } = new URL(request.url)
    const range = (searchParams.get('range')?.toUpperCase() || '30D') as '7D' | '30D' | '90D'

    const now = new Date()
    const tenantId = auth.tenantId

    // Ensure empty tenant has showcase data initialized
    const existingCount = await prisma.recoveryOpportunity.count({ where: { tenantId } })
    if (existingCount === 0) {
      await seedTenantShowcaseData(tenantId, auth.user.email)
    }

    // 1. Fetch opportunities for tenant
    const opportunities = await prisma.recoveryOpportunity.findMany({
      where: { tenantId }
    })

    // 2. Fetch recovery outcomes for tenant
    const recoveryOutcomes = await prisma.recoveryOutcome.findMany({
      where: { tenantId }
    })

    // 3. Fetch actions for tenant
    const actions = await prisma.recoveryAction.findMany({
      where: { tenantId }
    })

    // 4. Fetch executions for tenant
    const executions = await prisma.recoveryExecution.findMany({
      where: { tenantId }
    })

    // 5. Fetch captured payments / processed revenue
    const payments = await prisma.payment.findMany({
      where: { tenantId, status: 'CAPTURED' },
      select: { amountMinor: true }
    })
    const totalRevenueProcessedMinor = payments.reduce((sum, p) => sum + p.amountMinor, 0)

    // 6. Compute Financial Aggregates (Minor units)
    let totalAmountAtRiskMinor = 0
    let totalEstimatedRecoverableMinor = 0
    let outstandingAmountMinor = 0

    const countsByStatus: Record<string, number> = {}
    const countsByPriority: Record<string, number> = {}
    const countsByType: Record<string, number> = {}

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    let newOpportunitiesCount = 0

    for (const opp of opportunities) {
      totalAmountAtRiskMinor += opp.amountAtRiskMinor
      totalEstimatedRecoverableMinor += opp.recoverableAmountMinor

      if (opp.status === OpportunityStatus.DETECTED || opp.status === OpportunityStatus.IN_PROGRESS) {
        outstandingAmountMinor += opp.amountAtRiskMinor
      }

      if (opp.detectedAt >= sevenDaysAgo) {
        newOpportunitiesCount++
      }

      countsByStatus[opp.status] = (countsByStatus[opp.status] || 0) + 1
      countsByPriority[opp.priority] = (countsByPriority[opp.priority] || 0) + 1
      countsByType[opp.type] = (countsByType[opp.type] || 0) + 1
    }

    const successfulOutcomes = recoveryOutcomes.filter(o => o.type === OutcomeType.SUCCESS)
    const totalRecoveredRevenueMinor = successfulOutcomes.reduce((acc, out) => acc + out.recoveredAmountMinor, 0)

    // 7. Compute Action & Execution Aggregates
    const activeActionsCount = actions.filter(
      a => a.status === 'APPROVED' || a.status === 'EXECUTING'
    ).length

    const actionsByType: Record<string, number> = {}
    for (const act of actions) {
      actionsByType[act.type] = (actionsByType[act.type] || 0) + 1
    }

    const successfulExecutions = executions.filter(e => e.status === ExecutionStatus.SUCCEEDED).length
    const failedExecutions = executions.filter(e => e.status === ExecutionStatus.FAILED).length
    const queuedExecutions = executions.filter(e => e.status === ExecutionStatus.QUEUED).length
    const runningExecutions = executions.filter(e => e.status === ExecutionStatus.RUNNING).length
    const cancelledExecutions = executions.filter(e => e.status === ExecutionStatus.CANCELLED).length

    const completedExecutions = successfulExecutions + failedExecutions
    const executionSuccessRate = completedExecutions > 0
      ? Math.round((successfulExecutions / completedExecutions) * 100)
      : 100

    const retriedCount = executions.filter(e => e.attemptCount > 1).length
    const retryRate = executions.length > 0
      ? Math.round((retriedCount / executions.length) * 100)
      : 0

    // Execution latency
    const completedWithLatency = executions.filter(e => e.startedAt && e.completedAt)
    const totalLatency = completedWithLatency.reduce((acc, e) => acc + (e.completedAt!.getTime() - e.startedAt!.getTime()), 0)
    const averageExecutionLatencyMs = completedWithLatency.length > 0
      ? Math.round(totalLatency / completedWithLatency.length)
      : 0

    const totalResolvedFinancialMinor = totalAmountAtRiskMinor + totalRecoveredRevenueMinor
    const recoveryRate = totalResolvedFinancialMinor > 0
      ? Math.round((totalRecoveredRevenueMinor / totalResolvedFinancialMinor) * 100)
      : 0

    // 8. Breakdown by Provider
    const recoveryByProvider: Record<string, { count: number; recoveredMinor: number }> = {}
    for (const out of successfulOutcomes) {
      const p = out.provider || 'system'
      if (!recoveryByProvider[p]) {
        recoveryByProvider[p] = { count: 0, recoveredMinor: 0 }
      }
      recoveryByProvider[p].count++
      recoveryByProvider[p].recoveredMinor += out.recoveredAmountMinor
    }

    // 9. Time series buckets based on real database records within time range
    const timeSeriesData: Array<{ label: string; atRisk: number; recovered: number }> = []

    if (range === '7D') {
      for (let i = 6; i >= 0; i--) {
        const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
        const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i + 1)
        const label = dayStart.toLocaleDateString('en-US', { weekday: 'short' })

        const atRiskSum = opportunities
          .filter(o => o.createdAt >= dayStart && o.createdAt < dayEnd)
          .reduce((sum, o) => sum + o.amountAtRiskMinor / 100, 0)

        const recSum = successfulOutcomes
          .filter(o => o.occurredAt >= dayStart && o.occurredAt < dayEnd)
          .reduce((sum, o) => sum + o.recoveredAmountMinor / 100, 0)

        timeSeriesData.push({ label, atRisk: Math.round(atRiskSum), recovered: Math.round(recSum) })
      }
    } else if (range === '30D') {
      for (let w = 3; w >= 0; w--) {
        const weekStart = new Date(now.getTime() - (w + 1) * 7 * 24 * 60 * 60 * 1000)
        const weekEnd = new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000)
        const label = `Week ${4 - w}`

        const atRiskSum = opportunities
          .filter(o => o.createdAt >= weekStart && o.createdAt < weekEnd)
          .reduce((sum, o) => sum + o.amountAtRiskMinor / 100, 0)

        const recSum = successfulOutcomes
          .filter(o => o.occurredAt >= weekStart && o.occurredAt < weekEnd)
          .reduce((sum, o) => sum + o.recoveredAmountMinor / 100, 0)

        timeSeriesData.push({ label, atRisk: Math.round(atRiskSum), recovered: Math.round(recSum) })
      }
    } else {
      // 90D: 3 monthly buckets
      for (let m = 2; m >= 0; m--) {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - m, 1)
        const nextMonthDate = new Date(now.getFullYear(), now.getMonth() - m + 1, 1)
        const label = monthDate.toLocaleDateString('en-US', { month: 'short' })

        const atRiskSum = opportunities
          .filter(o => o.createdAt >= monthDate && o.createdAt < nextMonthDate)
          .reduce((sum, o) => sum + o.amountAtRiskMinor / 100, 0)

        const recSum = successfulOutcomes
          .filter(o => o.occurredAt >= monthDate && o.occurredAt < nextMonthDate)
          .reduce((sum, o) => sum + o.recoveredAmountMinor / 100, 0)

        timeSeriesData.push({ label, atRisk: Math.round(atRiskSum), recovered: Math.round(recSum) })
      }
    }

    return NextResponse.json({
      range,
      totals: {
        totalAmountAtRiskMinor,
        totalEstimatedRecoverableMinor,
        totalRecoveredRevenueMinor,
        outstandingAmountMinor,
        recoveryRate
      },
      revenue: {
        totalRevenueProcessedMinor,
        totalAmountAtRiskMinor,
        totalEstimatedRecoverableMinor,
        totalRecoveredRevenueMinor,
        outstandingAmountMinor,
        recoveryRate,
        currency: 'INR'
      },
      opportunities: {
        total: opportunities.length,
        newCount: newOpportunitiesCount,
        activeCount: (countsByStatus['DETECTED'] || 0) + (countsByStatus['IN_PROGRESS'] || 0),
        recoveredCount: countsByStatus['RECOVERED'] || 0,
        failedCount: countsByStatus['FAILED'] || 0,
        dismissedCount: countsByStatus['DISMISSED'] || 0,
        countsByStatus,
        countsByPriority,
        countsByType
      },
      executions: {
        totalExecutions: executions.length,
        successfulExecutions,
        failedExecutions,
        queuedExecutions,
        runningExecutions,
        cancelledExecutions,
        executionSuccessRate,
        retryRate,
        averageExecutionLatencyMs
      },
      rates: {
        recoveryRate,
        executionSuccessRate,
        retryRate
      },
      breakdowns: {
        activeActionsCount,
        byActionType: actionsByType,
        byPriority: countsByPriority,
        byOpportunityType: countsByType,
        byProvider: recoveryByProvider
      },
      timeSeries: timeSeriesData
    })
  } catch (err: any) {
    console.error('Error generating analytics:', err)
    return NextResponse.json({ error: 'Internal server error generating analytics' }, { status: 500 })
  }
}
