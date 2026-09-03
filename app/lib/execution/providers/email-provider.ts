import { ActionType, ExecutionStatus } from '@prisma/client'
import { ExecutionRequest, ExecutionResult, RecoveryExecutionProvider } from '../types'
import { providerHealthMonitor } from '../health'

export class EmailExecutionProvider implements RecoveryExecutionProvider {
  public readonly name = 'RESEND_EMAIL_PROVIDER'

  public supports(actionType: ActionType, channel?: string): boolean {
    if (channel?.toUpperCase() === 'EMAIL') return true
    return (
      actionType === ActionType.CONTACT_CUSTOMER ||
      actionType === ActionType.SEND_PAYMENT_REMINDER ||
      actionType === ActionType.ESCALATE
    )
  }

  public async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now()
    const recipientEmail = request.customer?.email
    const senderEmail = process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM || 'recoveries@reclaim-platform.com'
    const subject = request.messageSubject || `Important Notice: Your Payment of ${request.currency} ${(request.amountMinor / 100).toFixed(2)}`
    const body = request.messageBody || 'Please review and update your payment method to maintain uninterrupted service.'

    // 1. In AUDIT mode: Safely simulate email delivery
    if (request.mode === 'audit') {
      const simulatedRef = `resend_sim_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
      providerHealthMonitor.recordCall(this.name, {
        success: true,
        latencyMs: Date.now() - startTime
      })

      return {
        success: true,
        status: ExecutionStatus.SUCCEEDED,
        externalReference: simulatedRef,
        providerName: this.name,
        mode: request.mode,
        metadata: {
          simulated: true,
          recipient: recipientEmail || 'customer@example.com',
          sender: senderEmail,
          subject,
          bodySnippet: body.substring(0, 100),
          idempotencyKey: request.idempotencyKey
        },
        executedAt: new Date()
      }
    }

    // 2. In LIVE mode: Require genuine configuration
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      providerHealthMonitor.recordCall(this.name, {
        success: false,
        latencyMs: Date.now() - startTime,
        isAuthError: true,
        errorMessage: 'RESEND_API_KEY missing'
      })

      return {
        success: false,
        status: ExecutionStatus.FAILED,
        failureReason: 'PROVIDER_NOT_CONFIGURED: RESEND_API_KEY environment variable is not configured for live email delivery.',
        isRetryable: false,
        providerName: this.name,
        mode: request.mode,
        metadata: {
          errorType: 'MISSING_CREDENTIALS',
          provider: 'Resend'
        },
        executedAt: new Date()
      }
    }

    if (!recipientEmail) {
      providerHealthMonitor.recordCall(this.name, {
        success: false,
        latencyMs: Date.now() - startTime,
        errorMessage: 'Customer email address is missing'
      })

      return {
        success: false,
        status: ExecutionStatus.FAILED,
        failureReason: 'INVALID_RECIPIENT: Customer email address is missing.',
        isRetryable: false,
        providerName: this.name,
        mode: request.mode,
        executedAt: new Date()
      }
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': request.idempotencyKey
        },
        body: JSON.stringify({
          from: senderEmail,
          to: recipientEmail,
          subject,
          text: body
        }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)
      const latencyMs = Date.now() - startTime
      const data = await response.json()

      if (!response.ok) {
        const isAuth = response.status === 401 || response.status === 403
        const isRate = response.status === 429
        providerHealthMonitor.recordCall(this.name, {
          success: false,
          latencyMs,
          isAuthError: isAuth,
          isRateLimited: isRate,
          errorMessage: data.message || `Resend Error ${response.status}`
        })

        return {
          success: false,
          status: ExecutionStatus.FAILED,
          failureReason: `Resend API Error (${response.status}): ${data.message || 'Delivery failed'}`,
          isRetryable: response.status >= 500 || isRate,
          providerName: this.name,
          mode: request.mode,
          metadata: {
            httpStatus: response.status,
            isAuthError: isAuth,
            isRateLimited: isRate
          },
          executedAt: new Date()
        }
      }

      providerHealthMonitor.recordCall(this.name, {
        success: true,
        latencyMs
      })

      return {
        success: true,
        status: ExecutionStatus.SUCCEEDED,
        externalReference: data.id,
        providerName: this.name,
        mode: request.mode,
        metadata: {
          resendId: data.id,
          recipient: recipientEmail,
          sender: senderEmail
        },
        executedAt: new Date()
      }
    } catch (err: unknown) {
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      const errorMessage = isTimeout
        ? 'Request timed out after 10000ms'
        : err instanceof Error ? err.message : 'Unknown network failure'

      providerHealthMonitor.recordCall(this.name, {
        success: false,
        latencyMs: Date.now() - startTime,
        isTimeout,
        errorMessage
      })

      return {
        success: false,
        status: ExecutionStatus.FAILED,
        failureReason: `Network error reaching Resend: ${errorMessage}`,
        isRetryable: true,
        providerName: this.name,
        mode: request.mode,
        metadata: {
          isTimeout
        },
        executedAt: new Date()
      }
    }
  }
}
