/* eslint-disable @typescript-eslint/no-explicit-any */
import { ActionType, ExecutionStatus } from '@prisma/client'
import { ExecutionRequest, ExecutionResult, RecoveryExecutionProvider } from '../types'
import { RazorpayApiClient } from '../razorpay-client'
import { providerHealthMonitor } from '../health'

export class PaymentExecutionProvider implements RecoveryExecutionProvider {
  public readonly name = 'RAZORPAY_PAYMENT_PROVIDER'

  public supports(actionType: ActionType, channel?: string): boolean {
    if (channel?.toUpperCase() === 'AUTOMATED' || channel?.toUpperCase() === 'PAYMENT_GATEWAY') return true
    return (
      actionType === ActionType.RETRY_PAYMENT ||
      actionType === ActionType.RETRY_SUBSCRIPTION
    )
  }

  public async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now()

    // 1. In AUDIT mode: Safely simulate payment recovery action
    if (request.mode === 'audit') {
      const simulatedRef = `rzp_sim_pay_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
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
          actionType: request.actionType,
          amountMinor: request.amountMinor,
          currency: request.currency,
          idempotencyKey: request.idempotencyKey,
          targetCustomer: request.customer?.id || 'anonymous_customer'
        },
        executedAt: new Date()
      }
    }

    // 2. In LIVE mode: Genuine Razorpay API Client Integration
    const keyId = process.env.RAZORPAY_KEY_ID
    const keySecret = process.env.RAZORPAY_KEY_SECRET

    if (!keyId || !keySecret) {
      providerHealthMonitor.recordCall(this.name, {
        success: false,
        latencyMs: Date.now() - startTime,
        isAuthError: true,
        errorMessage: 'RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET missing'
      })

      return {
        success: false,
        status: ExecutionStatus.FAILED,
        failureReason: 'PROVIDER_NOT_CONFIGURED: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required for live payment execution.',
        isRetryable: false,
        providerName: this.name,
        mode: request.mode,
        metadata: {
          errorType: 'MISSING_CREDENTIALS',
          provider: 'Razorpay'
        },
        executedAt: new Date()
      }
    }

    try {
      const client = new RazorpayApiClient({ keyId, keySecret })

      // Create a genuine Razorpay Payment Link for dunning/recovery
      const linkResult = await client.createPaymentLink({
        amountMinor: request.amountMinor,
        currency: request.currency || 'INR',
        referenceId: request.idempotencyKey,
        description: request.messageSubject || `Recovery payment for ${request.customer?.name || 'order'}`,
        customer: {
          name: request.customer?.name,
          email: request.customer?.email,
          phone: request.customer?.phone || undefined
        },
        reminderEnable: true
      })

      const latencyMs = Date.now() - startTime
      providerHealthMonitor.recordCall(this.name, {
        success: true,
        latencyMs
      })

      const paymentLink = linkResult.data
      return {
        success: true,
        status: ExecutionStatus.SUCCEEDED,
        externalReference: paymentLink.id, // e.g. "plink_..."
        providerName: this.name,
        mode: request.mode,
        metadata: {
          razorpayPaymentLinkId: paymentLink.id,
          shortUrl: paymentLink.short_url,
          status: paymentLink.status,
          amountMinor: request.amountMinor,
          currency: request.currency
        },
        executedAt: new Date()
      }

    } catch (err: any) {
      const latencyMs = Date.now() - startTime
      providerHealthMonitor.recordCall(this.name, {
        success: false,
        latencyMs,
        isTimeout: err.isTimeout,
        isAuthError: err.isAuthError,
        isRateLimited: err.isRateLimited,
        errorMessage: err.message
      })

      return {
        success: false,
        status: ExecutionStatus.FAILED,
        failureReason: err.message || 'Razorpay API execution failed',
        isRetryable: Boolean(err.isServerError || err.isRateLimited || err.isTimeout),
        providerName: this.name,
        mode: request.mode,
        metadata: {
          razorpayError: err.razorpayError || null,
          httpStatus: err.status || null,
          isTimeout: Boolean(err.isTimeout),
          isAuthError: Boolean(err.isAuthError),
          isRateLimited: Boolean(err.isRateLimited)
        },
        executedAt: new Date()
      }
    }
  }
}
