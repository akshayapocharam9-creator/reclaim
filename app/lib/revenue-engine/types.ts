import { OpportunityType, PriorityLevel } from '@prisma/client'

export interface DetectedOpportunity {
  type: OpportunityType
  tenantId: string
  customerId?: string
  orderId?: string
  paymentId?: string
  checkoutSessionId?: string
  subscriptionId?: string
  
  // actualAmountAtRiskMinor MUST always represent actual money from the database.
  amountAtRiskMinor: number
  
  // estimatedRecoverableAmountMinor MUST be clearly treated as an estimated/modelled amount.
  // Do not claim that estimated recoverable revenue is actually recovered.
  estimatedRecoverableAmountMinor: number
  
  priority: PriorityLevel
  score: number
  confidenceScore: number | null
  reason: string
  evidence: Record<string, unknown>
  recommendation: Record<string, unknown> | null
  detectedAt: Date
}

export interface RevenueDetectionResult {
  opportunities: DetectedOpportunity[]
  totalAmountAtRiskMinor: number
  totalEstimatedRecoverableAmountMinor: number
  countsByType: Record<OpportunityType, number>
  countsByPriority: Record<PriorityLevel, number>
}
