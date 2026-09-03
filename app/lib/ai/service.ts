/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from '../prisma'
import { RecoveryOpportunity } from '@prisma/client'
import { RecoveryRecommendation } from '../recovery-agent/types'
import { AIReasoningInput, AIReasoningOutput } from './types'
import { getAIProvider, FallbackAIProvider } from './provider'

/**
 * Sanitizes untrusted user/merchant/gateway text to protect against prompt injection.
 * Strips instructions like 'ignore previous', 'override', and system command delimiters.
 */
export function sanitizePromptText(text?: string | null): string {
  if (!text) return ''
  return text
    .replace(/(\r\n|\n|\r)/gm, ' ')
    .replace(/(system:|assistant:|user:|prompt:|ignore previous|forget previous|override instructions|disregard|developer mode)/gi, '[FILTERED]')
    .substring(0, 250)
    .trim()
}

/**
 * Validates the strict schema of an AI-generated reasoning payload.
 */
export function validateAIOutput(raw: any): boolean {
  if (!raw || typeof raw !== 'object') return false
  if (typeof raw.summary !== 'string' || raw.summary.trim().length < 5) return false
  if (typeof raw.riskExplanation !== 'string' || raw.riskExplanation.trim().length < 5) return false
  if (typeof raw.reasoning !== 'string' || raw.reasoning.trim().length < 5) return false
  if (typeof raw.recommendedCommunication !== 'string' || raw.recommendedCommunication.trim().length < 5) return false
  if (typeof raw.suggestedCustomerMessage !== 'string' || raw.suggestedCustomerMessage.trim().length < 5) return false
  return true
}

/**
 * Builds minimal, sanitized business context for AI reasoning.
 * Ensures zero payment card credentials, signatures, or auth tokens are exposed.
 */
export function buildSanitizedContext(
  opportunity: RecoveryOpportunity & { customer?: { name: string } | null; payment?: { failureReason?: string | null; attempts?: any[] } | null },
  recommendation: RecoveryRecommendation
): AIReasoningInput {
  const amountAtRiskMajor = opportunity.amountAtRiskMinor / 100
  const expectedRecoveryMajor = opportunity.recoverableAmountMinor / 100

  // Count attempts if available from payment relations
  const failureCount = opportunity.payment?.attempts?.length || (opportunity.type === 'REPEATED_PAYMENT_FAILURE' ? 2 : 1)

  // Calculate days since detection
  const now = new Date()
  const daysSinceDetection = Math.max(0, Math.floor((now.getTime() - opportunity.detectedAt.getTime()) / (1000 * 60 * 60 * 24)))

  return {
    opportunityId: opportunity.id,
    opportunityType: opportunity.type,
    amountAtRiskMajor,
    expectedRecoveryMajor,
    currency: 'INR',
    priority: recommendation.priority,
    urgency: recommendation.urgency,
    recommendedAction: recommendation.recommendedAction,
    suggestedChannel: recommendation.suggestedChannel,
    deterministicReason: sanitizePromptText(recommendation.reason),
    failureCount,
    customerName: sanitizePromptText(opportunity.customer?.name) || undefined,
    lastFailureReason: sanitizePromptText(opportunity.payment?.attempts?.[0]?.failureReason) || undefined,
    daysSinceDetection
  }
}

/**
 * Generates AI reasoning for a recovery opportunity.
 * Incorporates cache check, provider execution, fallback safety, and cache persistence.
 */
export async function generateOpportunityAIReasoning(params: {
  opportunity: RecoveryOpportunity & { customer?: { name: string } | null; payment?: { failureReason?: string | null; attempts?: any[] } | null }
  recommendation: RecoveryRecommendation
  forceRefresh?: boolean
}): Promise<AIReasoningOutput> {
  const { opportunity, recommendation, forceRefresh } = params

  // 1. Check if cached AI reasoning exists on the opportunity
  const currentRec = opportunity.recommendation as Record<string, any> | null
  if (!forceRefresh && currentRec && currentRec.aiReasoning) {
    const cached = currentRec.aiReasoning as AIReasoningOutput
    if (validateAIOutput(cached)) {
      return cached
    }
  }

  // 2. Build sanitized context
  const context = buildSanitizedContext(opportunity, recommendation)

  // 3. Execute with selected AI Provider and resilient fallback
  const provider = getAIProvider()
  let output: AIReasoningOutput

  try {
    output = await provider.generateReasoning(context)
  } catch (err) {
    console.warn(`[AI_SERVICE_PROVIDER_FALLBACK] Provider '${provider.name}' failed: ${(err as Error).message}. Using deterministic fallback.`)
    const fallback = new FallbackAIProvider()
    output = await fallback.generateReasoning(context)
  }

  // 4. Validate output schema; if invalid, trigger deterministic fallback
  if (!validateAIOutput(output)) {
    console.warn('[AI_SERVICE_VALIDATION_FAILURE] Malformed AI output detected. Falling back to deterministic reasoning.')
    const fallback = new FallbackAIProvider()
    output = await fallback.generateReasoning(context)
  }

  // 5. Safely cache output into opportunity.recommendation without mutating financial data or status
  try {
    const updatedRec = {
      ...(typeof currentRec === 'object' && currentRec !== null ? currentRec : {}),
      aiReasoning: output
    }

    await prisma.recoveryOpportunity.update({
      where: { id: opportunity.id },
      data: {
        recommendation: updatedRec as any
      }
    })
  } catch (err) {
    console.error('[AI_SERVICE_CACHE_WRITE_ERROR] Failed to persist AI cache:', err)
    // Non-fatal: caching failure must never break response delivery
  }

  return output
}
