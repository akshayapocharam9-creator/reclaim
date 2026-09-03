import prisma from '../prisma'
import { RevenueEngineInput } from './index'

/**
 * Adapter to bridge Prisma Database layer with the pure deterministic Revenue Leak Engine.
 * Ensures strict tenant isolation by always querying with tenantId.
 */
export async function fetchTenantDataForEngine(tenantId: string): Promise<RevenueEngineInput> {
  // Parallel fetch for performance, strictly scoped to the tenant
  const [payments, checkoutSessions, subscriptions] = await Promise.all([
    prisma.payment.findMany({
      where: { tenantId },
      include: {
        attempts: true // Necessary for detecting REPEATED_PAYMENT_FAILURE
      }
    }),
    prisma.checkoutSession.findMany({
      where: { tenantId }
    }),
    prisma.subscription.findMany({
      where: { tenantId }
    })
  ])

  return {
    payments,
    checkoutSessions,
    subscriptions
  }
}
