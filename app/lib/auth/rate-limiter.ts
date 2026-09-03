import prisma from '../prisma'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds?: number
}

/**
 * Database-backed rate limiter using AuditEvent records in PostgreSQL.
 * Distributed-safe across serverless and multi-instance environments without Redis.
 */
export async function checkRateLimit(params: {
  tenantId: string
  eventType: string
  maxRequests: number
  windowSeconds: number
}): Promise<RateLimitResult> {
  const { tenantId, eventType, maxRequests, windowSeconds } = params

  try {
    const windowStart = new Date(Date.now() - windowSeconds * 1000)

    const count = await prisma.auditEvent.count({
      where: {
        tenantId,
        eventType,
        timestamp: {
          gte: windowStart
        }
      }
    })

    if (count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: windowSeconds
      }
    }

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - count - 1)
    }
  } catch (err) {
    // If rate limiter check encounters DB issues, fail open to avoid service outage
    console.error('Rate limiter check error:', err)
    return {
      allowed: true,
      remaining: 1
    }
  }
}
