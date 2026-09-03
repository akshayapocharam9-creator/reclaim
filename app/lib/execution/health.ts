export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNCONFIGURED'

export interface ProviderHealthStats {
  providerName: string
  status: HealthStatus
  totalRequests: number
  successCount: number
  failureCount: number
  timeoutCount: number
  authFailureCount: number
  rateLimitCount: number
  successRate: number
  averageLatencyMs: number
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
}

interface CallRecord {
  timestamp: number
  success: boolean
  latencyMs: number
  isTimeout?: boolean
  isAuthError?: boolean
  isRateLimited?: boolean
  errorMessage?: string
}

class ProviderHealthMonitor {
  private history: Map<string, CallRecord[]> = new Map()
  private maxHistoryPerProvider = 50

  public recordCall(
    providerName: string,
    params: {
      success: boolean
      latencyMs: number
      isTimeout?: boolean
      isAuthError?: boolean
      isRateLimited?: boolean
      errorMessage?: string
    }
  ) {
    if (!this.history.has(providerName)) {
      this.history.set(providerName, [])
    }

    const records = this.history.get(providerName)!
    records.push({
      timestamp: Date.now(),
      ...params
    })

    if (records.length > this.maxHistoryPerProvider) {
      records.shift()
    }
  }

  public getStats(providerName: string, isConfigured = true): ProviderHealthStats {
    if (!isConfigured) {
      return {
        providerName,
        status: 'UNCONFIGURED',
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        timeoutCount: 0,
        authFailureCount: 0,
        rateLimitCount: 0,
        successRate: 0,
        averageLatencyMs: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: 'Provider credentials not configured'
      }
    }

    const records = this.history.get(providerName) || []
    if (records.length === 0) {
      return {
        providerName,
        status: 'HEALTHY',
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        timeoutCount: 0,
        authFailureCount: 0,
        rateLimitCount: 0,
        successRate: 100,
        averageLatencyMs: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: null
      }
    }

    const totalRequests = records.length
    const successCount = records.filter(r => r.success).length
    const failureCount = totalRequests - successCount
    const timeoutCount = records.filter(r => r.isTimeout).length
    const authFailureCount = records.filter(r => r.isAuthError).length
    const rateLimitCount = records.filter(r => r.isRateLimited).length

    const totalLatency = records.reduce((sum, r) => sum + r.latencyMs, 0)
    const averageLatencyMs = Math.round(totalLatency / totalRequests)
    const successRate = Math.round((successCount / totalRequests) * 100)

    const lastSuccess = [...records].reverse().find(r => r.success)
    const lastFailure = [...records].reverse().find(r => !r.success)

    let status: HealthStatus = 'HEALTHY'
    if (authFailureCount > 0 || timeoutCount >= 3) {
      status = 'DOWN'
    } else if (successRate < 75) {
      status = 'DEGRADED'
    }

    return {
      providerName,
      status,
      totalRequests,
      successCount,
      failureCount,
      timeoutCount,
      authFailureCount,
      rateLimitCount,
      successRate,
      averageLatencyMs,
      lastSuccessAt: lastSuccess ? new Date(lastSuccess.timestamp).toISOString() : null,
      lastFailureAt: lastFailure ? new Date(lastFailure.timestamp).toISOString() : null,
      lastError: lastFailure?.errorMessage || null
    }
  }

  public getAllStats(configs: Record<string, boolean>): ProviderHealthStats[] {
    const providers = ['RAZORPAY_PAYMENT_PROVIDER', 'RESEND_EMAIL_PROVIDER', 'SIMULATION_PROVIDER']
    return providers.map(p => this.getStats(p, configs[p] ?? true))
  }
}

export const providerHealthMonitor = new ProviderHealthMonitor()
