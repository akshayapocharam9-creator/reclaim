/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from '../prisma'
import { MembershipRole } from '@prisma/client'

export interface LogAuditParams {
  tenantId: string
  opportunityId?: string | null
  actor?: {
    id?: string
    email?: string
    role?: MembershipRole
  } | null
  eventType: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown>
}

// Keys that must NEVER be persisted in audit metadata
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'session',
  'secret',
  'apikey',
  'card',
  'cvv',
  'number',
  'auth'
])

function sanitizeAuditMetadata(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined
  const cleaned: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase()
    let isSensitive = false
    for (const forbidden of SENSITIVE_KEYS) {
      if (lowerKey.includes(forbidden)) {
        isSensitive = true
        break
      }
    }

    if (isSensitive) {
      cleaned[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      cleaned[key] = sanitizeAuditMetadata(value as Record<string, unknown>)
    } else {
      cleaned[key] = value
    }
  }

  return cleaned
}

/**
 * Persists an immutable audit record in the database.
 */
export async function logAuditEvent(params: LogAuditParams) {
  try {
    const safeMetadata = sanitizeAuditMetadata(params.metadata)

    try {
      return await prisma.auditEvent.create({
        data: {
          tenantId: params.tenantId,
          opportunityId: params.opportunityId || null,
          actorId: params.actor?.id || null,
          actorEmail: params.actor?.email || null,
          actorRole: params.actor?.role || null,
          eventType: params.eventType,
          entityType: params.entityType,
          entityId: params.entityId || null,
          metadata: safeMetadata as any
        }
      })
    } catch (err: any) {
      if (err?.code === 'P2003' && params.opportunityId) {
        return await prisma.auditEvent.create({
          data: {
            tenantId: params.tenantId,
            opportunityId: null,
            actorId: params.actor?.id || null,
            actorEmail: params.actor?.email || null,
            actorRole: params.actor?.role || null,
            eventType: params.eventType,
            entityType: params.entityType,
            entityId: params.entityId || null,
            metadata: { ...(safeMetadata as any), referencedOpportunityId: params.opportunityId }
          }
        })
      }
      throw err
    }
  } catch (err) {
    // Audit logging should never crash the main application, but should be logged to console
    console.error('Failed to log audit event:', err)
    return null
  }
}
