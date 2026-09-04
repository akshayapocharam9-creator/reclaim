/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto'
import prisma from '../prisma'
import { OpportunityStatus, OutcomeType, ActionStatus, RecoveryToken, RecoveryOpportunity, Tenant } from '@prisma/client'
import { logAuditEvent } from '../audit/audit-service'
import { ProviderRegistry } from '../execution/registry'
import { stopActiveCadenceForOpportunity } from './dunning-cadence-service'

export interface CreateRecoveryTokenParams {
  tenantId: string
  opportunityId: string
  purpose?: string
  expiresInSeconds?: number
  metadata?: Record<string, unknown>
}

export interface CreateRecoveryTokenResult {
  rawToken: string
  recoveryUrl: string
  tokenRecord: RecoveryToken
}

export type TokenVerificationError =
  | 'INVALID_FORMAT'
  | 'INVALID_TOKEN'
  | 'EXPIRED'
  | 'REVOKED'
  | 'ALREADY_CONSUMED'
  | 'ALREADY_RECOVERED'

export interface TokenVerificationResult {
  valid: boolean
  error?: TokenVerificationError
  message: string
  alreadyResolved?: boolean
  recoveryToken?: RecoveryToken
  opportunity?: RecoveryOpportunity & {
    customer?: { name: string | null; email: string | null; phone: string | null } | null
    order?: { id: string; providerOrderId: string | null } | null
    payment?: { id: string; providerPaymentId: string | null } | null
  }
  tenant?: Tenant
}

export interface PublicRecoveryDetailsResponse {
  valid: boolean
  error?: TokenVerificationError
  message?: string
  alreadyResolved?: boolean
  merchantName?: string
  customerName?: string | null
  maskedEmail?: string | null
  amountMinor?: number
  amountFormatted?: string
  currency?: string
  reason?: string
  opportunityType?: string
  status?: OpportunityStatus
  expiresAt?: string
  orderReference?: string | null
  mode?: 'audit' | 'live'
  resolutionReceipt?: {
    receiptId: string
    recoveredAt: string
    recoveredAmountFormatted: string
  } | null
}

export interface ResolvePaymentOptions {
  paymentMethod?: string
  actorIp?: string
  userAgent?: string
  notes?: string
}

export interface PaymentResolutionResponse {
  success: boolean
  statusCode: number
  error?: string
  receiptId?: string
  recoveredAmountMinor?: number
  currency?: string
  recoveredAt?: string
  opportunityStatus?: OpportunityStatus
  alreadyResolved?: boolean
}

/**
 * Computes deterministic SHA-256 hash of a raw token.
 * Plaintext tokens are NEVER persisted to the database.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex')
}

/**
 * Masks an email for public customer display to protect PII.
 * Example: customer.name@example.com -> c***e@e***.com
 */
export function maskEmail(email: string): string {
  const parts = email.split('@')
  if (parts.length !== 2) return '***@***'
  const [local, domain] = parts
  const maskedLocal = local.length <= 2 ? local[0] + '***' : local[0] + '***' + local[local.length - 1]
  const domainParts = domain.split('.')
  const maskedDomain = domainParts[0].length <= 2 ? domainParts[0][0] + '***' : domainParts[0][0] + '***'
  return `${maskedLocal}@${maskedDomain}.${domainParts.slice(1).join('.') || 'com'}`
}

/**
 * Translates technical gateway error strings into friendly, professional customer explanations.
 */
export function sanitizeCustomerReason(rawReason: string): string {
  if (!rawReason) return 'The payment could not be completed successfully.'
  const lower = rawReason.toLowerCase()
  if (lower.includes('insufficient') || lower.includes('balance')) {
    return 'The transaction could not be completed due to insufficient funds in the account.'
  }
  if (lower.includes('expired') || lower.includes('expiry')) {
    return 'The card or payment method provided has expired.'
  }
  if (lower.includes('cvv') || lower.includes('security')) {
    return 'The card verification code (CVV) could not be verified.'
  }
  if (lower.includes('declined') || lower.includes('rejected') || lower.includes('do not honor')) {
    return 'The transaction was declined by your card issuing bank or payment provider.'
  }
  if (lower.includes('otp') || lower.includes('authentication') || lower.includes('3ds')) {
    return 'Two-factor or 3D-Secure authentication was not completed.'
  }
  if (lower.includes('limit')) {
    return 'The transaction exceeded the authorized card or account limit.'
  }
  return 'Your financial institution was unable to process the scheduled payment attempt.'
}

/**
 * Formats minor currency units into human readable INR display.
 */
export function formatCurrencyAmount(amountMinor: number, currency: string = 'INR'): string {
  const major = (amountMinor / 100).toFixed(2)
  if (currency.toUpperCase() === 'INR') {
    return `₹${Number(major).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return `${currency.toUpperCase()} ${major}`
}

/**
 * Creates a cryptographically secure, high-entropy single-use recovery token.
 * Persists ONLY the SHA-256 hash to PostgreSQL.
 */
export async function createRecoveryToken(params: CreateRecoveryTokenParams): Promise<CreateRecoveryTokenResult> {
  const { tenantId, opportunityId, purpose = 'PAYMENT_RECOVERY', expiresInSeconds = 72 * 3600, metadata } = params

  // 1. Verify opportunity exists and belongs to tenant
  const opportunity = await prisma.recoveryOpportunity.findUnique({
    where: { id: opportunityId },
    include: { tenant: true }
  })

  if (!opportunity || opportunity.tenantId !== tenantId) {
    throw new Error('Recovery opportunity not found for specified tenant')
  }

  // Reject token generation if opportunity is already in terminal state
  if (
    opportunity.status === OpportunityStatus.RECOVERED ||
    opportunity.status === OpportunityStatus.FAILED ||
    opportunity.status === OpportunityStatus.DISMISSED
  ) {
    throw new Error(`Cannot generate recovery token for opportunity in terminal state (${opportunity.status})`)
  }

  // 2. Generate 32 bytes (256 bits) of cryptographically secure random entropy
  const rawToken = crypto.randomBytes(32).toString('hex')
  const tokenHash = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000)

  // 3. Persist hash in database
  const tokenRecord = await prisma.recoveryToken.create({
    data: {
      tenantId,
      opportunityId,
      tokenHash,
      purpose,
      expiresAt,
      metadata: metadata ? (metadata as any) : undefined
    }
  })

  // 4. Construct base public URL
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL 
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` 
    : 'https://reclaim-tau-eight.vercel.app')
  const recoveryUrl = `${baseUrl.replace(/\/+$/, '')}/recover/${rawToken}`

  // 5. Audit log token generation (never logging raw token)
  await logAuditEvent({
    tenantId,
    opportunityId,
    eventType: 'RECOVERY_TOKEN_GENERATED',
    entityType: 'RecoveryToken',
    entityId: tokenRecord.id,
    metadata: {
      purpose,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds
    }
  })

  return {
    rawToken,
    recoveryUrl,
    tokenRecord
  }
}

/**
 * Cryptographically verifies a recovery token against the database.
 * Enforces:
 * - Valid format (64-char hex string)
 * - Existence of hash in DB
 * - Expiration check
 * - Revocation check
 * - Single-use consumption check
 * - Current opportunity recovery status check
 */
export async function verifyRecoveryToken(rawToken: string): Promise<TokenVerificationResult> {
  if (!rawToken || typeof rawToken !== 'string') {
    return { valid: false, error: 'INVALID_FORMAT', message: 'Recovery token is missing or malformed.' }
  }

  const trimmed = rawToken.trim()
  // 32 bytes = 64 hex characters
  if (!/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    return { valid: false, error: 'INVALID_FORMAT', message: 'Recovery token format is invalid.' }
  }

  const tokenHash = hashToken(trimmed)

  const record = await prisma.recoveryToken.findUnique({
    where: { tokenHash },
    include: {
      tenant: true,
      opportunity: {
        include: {
          customer: {
            select: { name: true, email: true, phone: true }
          },
          order: {
            select: { id: true, providerOrderId: true }
          },
          payment: {
            select: { id: true, providerPaymentId: true }
          }
        }
      }
    }
  })

  if (!record) {
    return { valid: false, error: 'INVALID_TOKEN', message: 'Recovery link is invalid or does not exist.' }
  }

  const now = new Date()

  if (record.revokedAt) {
    return {
      valid: false,
      error: 'REVOKED',
      message: 'This recovery link has been revoked. Please contact the merchant for an updated link.'
    }
  }

  if (record.consumedAt) {
    return {
      valid: false,
      error: 'ALREADY_CONSUMED',
      message: 'This recovery link has already been used.',
      alreadyResolved: true,
      recoveryToken: record,
      opportunity: record.opportunity,
      tenant: record.tenant
    }
  }

  if (record.expiresAt < now) {
    return {
      valid: false,
      error: 'EXPIRED',
      message: 'This recovery link has expired. Please contact the merchant for a new link.'
    }
  }

  if (record.opportunity.status === OpportunityStatus.RECOVERED) {
    return {
      valid: false,
      error: 'ALREADY_RECOVERED',
      message: 'This payment has already been successfully recovered.',
      alreadyResolved: true,
      recoveryToken: record,
      opportunity: record.opportunity,
      tenant: record.tenant
    }
  }

  if (record.opportunity.status === OpportunityStatus.FAILED || record.opportunity.status === OpportunityStatus.DISMISSED) {
    return {
      valid: false,
      error: 'ALREADY_RECOVERED',
      message: `This recovery opportunity has already been closed (${record.opportunity.status.toLowerCase()}).`,
      alreadyResolved: true,
      recoveryToken: record,
      opportunity: record.opportunity,
      tenant: record.tenant
    }
  }

  return {
    valid: true,
    message: 'Token is valid.',
    recoveryToken: record,
    opportunity: record.opportunity,
    tenant: record.tenant
  }
}

/**
 * Returns sanitized, public-safe recovery details for customer viewing.
 * Masks PII and hides internal database IDs and technical stack traces.
 */
export async function getPublicRecoveryDetails(rawToken: string): Promise<PublicRecoveryDetailsResponse> {
  const verification = await verifyRecoveryToken(rawToken)

  if (!verification.valid) {
    if (verification.alreadyResolved && verification.opportunity) {
      return {
        valid: false,
        alreadyResolved: true,
        error: verification.error,
        message: verification.message,
        merchantName: verification.tenant?.name || 'Merchant',
        customerName: verification.opportunity.customer?.name || null,
        amountMinor: verification.opportunity.amountAtRiskMinor,
        amountFormatted: formatCurrencyAmount(verification.opportunity.amountAtRiskMinor, 'INR'),
        status: verification.opportunity.status,
        resolutionReceipt: {
          receiptId: `REC-${verification.opportunity.id.substring(0, 8).toUpperCase()}`,
          recoveredAt: verification.opportunity.resolvedAt?.toISOString() || new Date().toISOString(),
          recoveredAmountFormatted: formatCurrencyAmount(verification.opportunity.amountAtRiskMinor, 'INR')
        }
      }
    }

    return {
      valid: false,
      error: verification.error,
      message: verification.message
    }
  }

  const { opportunity, tenant, recoveryToken } = verification
  const mode = ProviderRegistry.getExecutionMode()

  return {
    valid: true,
    merchantName: tenant!.name,
    customerName: opportunity!.customer?.name || null,
    maskedEmail: opportunity!.customer?.email ? maskEmail(opportunity!.customer.email) : null,
    amountMinor: opportunity!.amountAtRiskMinor,
    amountFormatted: formatCurrencyAmount(opportunity!.amountAtRiskMinor, 'INR'),
    currency: 'INR',
    reason: sanitizeCustomerReason(opportunity!.reason),
    opportunityType: opportunity!.type,
    status: opportunity!.status,
    expiresAt: recoveryToken!.expiresAt.toISOString(),
    orderReference: opportunity!.order?.providerOrderId || opportunity!.payment?.providerPaymentId || opportunity!.id.substring(0, 10),
    mode
  }
}

/**
 * Transactionally resolves a payment using the recovery token.
 * Protects against replay attacks, race conditions, and double resolutions.
 */
export async function resolvePaymentWithToken(
  rawToken: string,
  options: ResolvePaymentOptions = {}
): Promise<PaymentResolutionResponse> {
  const verification = await verifyRecoveryToken(rawToken)

  if (!verification.valid) {
    if (verification.alreadyResolved) {
      return {
        success: true,
        statusCode: 200,
        alreadyResolved: true,
        receiptId: `REC-${verification.opportunity?.id.substring(0, 8).toUpperCase()}`,
        recoveredAmountMinor: verification.opportunity?.amountAtRiskMinor,
        currency: 'INR',
        opportunityStatus: OpportunityStatus.RECOVERED
      }
    }
    return {
      success: false,
      statusCode: verification.error === 'EXPIRED' || verification.error === 'REVOKED' ? 410 : 400,
      error: verification.message
    }
  }

  const { recoveryToken, opportunity, tenant } = verification
  const now = new Date()
  const mode = ProviderRegistry.getExecutionMode()
  const receiptId = `REC-${opportunity!.id.substring(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`

  // Use interactive transaction to guarantee single-use consumption and atomic state sync
  return await prisma.$transaction(async (tx) => {
    // Re-verify token status under lock to prevent concurrent double-consumption
    const freshToken = await tx.recoveryToken.findUnique({
      where: { id: recoveryToken!.id }
    })

    if (!freshToken || freshToken.consumedAt || freshToken.revokedAt) {
      return {
        success: false,
        statusCode: 409,
        error: 'Recovery link has already been consumed or revoked.'
      }
    }

    // Re-verify opportunity status under lock to prevent race conditions with concurrent recoveries
    const freshOpp = await tx.recoveryOpportunity.findUnique({
      where: { id: opportunity!.id }
    })

    if (!freshOpp) {
      return {
        success: false,
        statusCode: 404,
        error: 'Opportunity record not found.'
      }
    }

    if (freshOpp.status === OpportunityStatus.RECOVERED) {
      return {
        success: true,
        statusCode: 200,
        alreadyResolved: true,
        receiptId: `REC-${freshOpp.id.substring(0, 8).toUpperCase()}`,
        recoveredAmountMinor: freshOpp.amountAtRiskMinor,
        currency: 'INR',
        opportunityStatus: OpportunityStatus.RECOVERED
      }
    }

    if (freshOpp.status === OpportunityStatus.FAILED || freshOpp.status === OpportunityStatus.DISMISSED) {
      return {
        success: false,
        statusCode: 409,
        error: `Recovery opportunity has already been closed (${freshOpp.status}).`
      }
    }

    // 1. Mark token consumed
    await tx.recoveryToken.update({
      where: { id: recoveryToken!.id },
      data: {
        consumedAt: now,
        metadata: {
          ...(freshToken.metadata as Record<string, unknown> || {}),
          consumedByIp: options.actorIp || 'customer_browser',
          consumedUserAgent: options.userAgent ? options.userAgent.substring(0, 200) : null,
          resolutionMode: mode,
          paymentMethod: options.paymentMethod || 'CUSTOMER_PORTAL'
        } as any
      }
    })

    // 2. Create RecoveryOutcome
    const outcome = await tx.recoveryOutcome.create({
      data: {
        tenantId: tenant!.id,
        opportunityId: opportunity!.id,
        type: OutcomeType.SUCCESS,
        recoveredAmountMinor: opportunity!.amountAtRiskMinor,
        unrecoveredAmountMinor: 0,
        currency: 'INR',
        provider: mode === 'live' ? 'razorpay_customer_portal' : 'reclaim_portal_simulation',
        providerReference: receiptId,
        reason: 'Customer resolved payment via self-service recovery portal',
        details: {
          resolvedVia: 'CUSTOMER_PORTAL',
          mode,
          paymentMethod: options.paymentMethod || 'CUSTOMER_DIRECT',
          receiptId
        } as any,
        metadata: {
          tokenId: recoveryToken!.id,
          actorIp: options.actorIp || null
        } as any,
        occurredAt: now
      }
    })

    // 3. Update Opportunity status to RECOVERED
    const updatedOpp = await tx.recoveryOpportunity.update({
      where: { id: opportunity!.id },
      data: {
        status: OpportunityStatus.RECOVERED,
        resolvedAt: now
      }
    })

    // 4. Update any pending or executing recovery actions to EXECUTED
    await tx.recoveryAction.updateMany({
      where: {
        opportunityId: opportunity!.id,
        status: { in: [ActionStatus.PENDING, ActionStatus.APPROVED, ActionStatus.EXECUTING] }
      },
      data: {
        status: ActionStatus.EXECUTED,
        executedAt: now,
        notes: `Resolved via customer recovery portal (Receipt ${receiptId})`
      }
    })

    // 5. Immediately stop any active dunning cadence transactionally
    await stopActiveCadenceForOpportunity({
      tenantId: tenant!.id,
      opportunityId: opportunity!.id,
      terminalStatus: OpportunityStatus.RECOVERED,
      tx
    })

    // 6. Log audit event
    await logAuditEvent({
      tenantId: tenant!.id,
      opportunityId: opportunity!.id,
      eventType: 'CUSTOMER_PORTAL_PAYMENT_RESOLVED',
      entityType: 'RecoveryOutcome',
      entityId: outcome.id,
      metadata: {
        receiptId,
        recoveredAmountMinor: opportunity!.amountAtRiskMinor,
        tokenId: recoveryToken!.id,
        mode
      }
    })

    return {
      success: true,
      statusCode: 200,
      receiptId,
      recoveredAmountMinor: opportunity!.amountAtRiskMinor,
      currency: 'INR',
      recoveredAt: now.toISOString(),
      opportunityStatus: updatedOpp.status
    }
  })
}

/**
 * Revokes a recovery token so it can no longer be accessed or used.
 */
export async function revokeRecoveryToken(rawToken: string, reason?: string): Promise<boolean> {
  const tokenHash = hashToken(rawToken)
  const token = await prisma.recoveryToken.findUnique({ where: { tokenHash } })
  if (!token) return false

  await prisma.recoveryToken.update({
    where: { id: token.id },
    data: {
      revokedAt: new Date(),
      metadata: {
        ...(token.metadata as Record<string, unknown> || {}),
        revocationReason: reason || 'Manually revoked'
      } as any
    }
  })

  await logAuditEvent({
    tenantId: token.tenantId,
    opportunityId: token.opportunityId,
    eventType: 'RECOVERY_TOKEN_REVOKED',
    entityType: 'RecoveryToken',
    entityId: token.id,
    metadata: { reason }
  })

  return true
}