/* eslint-disable @typescript-eslint/no-explicit-any */

export type StructuredEventName =
  | 'RECOVERY_POLICY_EVALUATED'
  | 'RECOVERY_EXECUTION_QUEUED'
  | 'RECOVERY_EXECUTION_STARTED'
  | 'RECOVERY_PROVIDER_REQUESTED'
  | 'RECOVERY_PROVIDER_SUCCEEDED'
  | 'RECOVERY_PROVIDER_FAILED'
  | 'RAZORPAY_WEBHOOK_RECEIVED'
  | 'RAZORPAY_PAYMENT_CONFIRMED'
  | 'RAZORPAY_PAYMENT_FAILED'
  | 'RECOVERY_RECONCILED'
  | 'RECOVERY_RECONCILIATION_AMBIGUOUS'
  | 'RECOVERY_REQUIRES_REVIEW'
  | 'WORKER_BATCH_PROCESSED'
  | 'STALE_EXECUTION_RECOVERED'
  | 'KILL_SWITCH_TOGGLED'

export interface CorrelationContext {
  tenantId?: string
  opportunityId?: string
  executionId?: string
  webhookEventId?: string
  gatewayPaymentId?: string
  gatewayOrderId?: string
  policyId?: string
  policyVersion?: number
  provider?: string
  actionType?: string
}

const REDACTED_KEYS = new Set([
  'password',
  'secret',
  'token',
  'key',
  'authorization',
  'cookie',
  'card',
  'cvv',
  'pan',
  'signature'
])

function sanitizeObject(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj
  if (obj instanceof Date) return obj.toISOString()
  if (Array.isArray(obj)) return obj.map(sanitizeObject)

  const sanitized: Record<string, any> = {}
  for (const [k, v] of Object.entries(obj)) {
    const lower = k.toLowerCase()
    const isSensitive = Array.from(REDACTED_KEYS).some(rk => lower.includes(rk))
    if (isSensitive) {
      sanitized[k] = '[REDACTED]'
    } else if (typeof v === 'object' && v !== null) {
      sanitized[k] = sanitizeObject(v)
    } else {
      sanitized[k] = v
    }
  }
  return sanitized
}

export class StructuredLogger {
  public static log(
    level: 'INFO' | 'WARN' | 'ERROR',
    eventName: StructuredEventName,
    correlation: CorrelationContext,
    payload?: Record<string, unknown>
  ) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      event: eventName,
      correlation: sanitizeObject(correlation),
      data: payload ? sanitizeObject(payload) : undefined
    }

    const logStr = JSON.stringify(entry)

    if (level === 'ERROR') {
      console.error(logStr)
    } else if (level === 'WARN') {
      console.warn(logStr)
    } else {
      console.log(logStr)
    }
  }

  public static info(eventName: StructuredEventName, correlation: CorrelationContext, payload?: Record<string, unknown>) {
    this.log('INFO', eventName, correlation, payload)
  }

  public static warn(eventName: StructuredEventName, correlation: CorrelationContext, payload?: Record<string, unknown>) {
    this.log('WARN', eventName, correlation, payload)
  }

  public static error(eventName: StructuredEventName, correlation: CorrelationContext, payload?: Record<string, unknown>) {
    this.log('ERROR', eventName, correlation, payload)
  }
}
