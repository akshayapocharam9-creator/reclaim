/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import prisma from '../prisma'
import { OrderStatus, PaymentStatus, AttemptStatus, SubscriptionStatus } from '@prisma/client'
import { syncTenantOpportunities } from '../intelligence/persist-insights'
import { processWebhookFeedback } from './webhook-feedback'

export type ProcessResult = 
  | { status: 'processed' }
  | { status: 'duplicate' }
  | { status: 'unsupported' }
  | { status: 'error', errorType: 'tenant_not_found' | 'database_error', message: string }

const SUPPORTED_EVENTS = [
  'payment.authorized',
  'payment.captured',
  'payment.failed',
  'payment.refunded',
  'subscription.activated',
  'subscription.charged',
  'subscription.pending',
  'subscription.halted',
  'subscription.cancelled',
  'subscription.completed'
]

export async function processRazorpayWebhook(tenantId: string, eventId: string, payload: any): Promise<ProcessResult> {
  const eventType = payload.event
  
  if (!eventType || !SUPPORTED_EVENTS.includes(eventType)) {
    return { status: 'unsupported' }
  }

  try {
    // 1. Verify tenant
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) {
      return { status: 'error', errorType: 'tenant_not_found', message: 'Tenant does not exist' }
    }

    let savedWebhookEventId: string | undefined

    // 2. Atomic Transaction Execution
    await prisma.$transaction(async (tx) => {
      // 3. Race-Safe Idempotency
      // Rely on the database unique constraint [tenantId, provider, eventId] to prevent race conditions.
      try {
        const savedEvent = await tx.webhookEvent.create({
          data: {
            tenantId,
            provider: 'razorpay',
            eventId,
            eventType,
            payload, // Store raw payload for audit
            processedAt: new Date()
          }
        })
        savedWebhookEventId = savedEvent.id
      } catch (error: any) {
        // P2002 is Prisma's unique constraint violation error code
        if (error.code === 'P2002') {
          throw new Error('IDEMPOTENCY_DUPLICATE')
        }
        throw error
      }

      // 4. Data Mapping
      const paymentPayload = payload.payload?.payment?.entity
      const orderPayload = payload.payload?.order?.entity
      const subPayload = payload.payload?.subscription?.entity

      const providerCustomerId = subPayload?.customer_id || paymentPayload?.customer_id || orderPayload?.customer_id
      const customerEmail = paymentPayload?.email || subPayload?.email || 'unknown@example.com'
      const customerContact = paymentPayload?.contact || subPayload?.contact || null

      let customerId: string | null = null

      // UPSERT CUSTOMER
      if (providerCustomerId) {
        const cust = await tx.customer.upsert({
          where: {
            tenantId_provider_providerCustomerId: { tenantId, provider: 'razorpay', providerCustomerId }
          },
          update: {},
          create: {
            tenantId,
            provider: 'razorpay',
            providerCustomerId,
            name: 'Razorpay Customer',
            email: customerEmail,
            phone: customerContact
          }
        })
        customerId = cust.id
      }

      const providerOrderId = orderPayload?.id || paymentPayload?.order_id
      let orderId: string | null = null

      // UPSERT ORDER (with State Precedence)
      if (providerOrderId && customerId) {
        const amount = orderPayload?.amount || paymentPayload?.amount || 0
        const currency = orderPayload?.currency || paymentPayload?.currency || 'INR'

        let newOrderStatus: OrderStatus = OrderStatus.PENDING
        if (eventType === 'payment.captured' || eventType === 'subscription.charged') newOrderStatus = OrderStatus.PAID
        if (eventType === 'payment.failed') newOrderStatus = OrderStatus.FAILED
        if (eventType === 'payment.refunded') newOrderStatus = OrderStatus.REFUNDED

        const existingOrder = await tx.order.findUnique({
          where: { tenantId_provider_providerOrderId: { tenantId, provider: 'razorpay', providerOrderId } }
        })

        let statusToSave = newOrderStatus
        if (existingOrder) {
          const current = existingOrder.status
          if (current === OrderStatus.REFUNDED) {
            statusToSave = OrderStatus.REFUNDED
          } else if (current === OrderStatus.PAID && (newOrderStatus === OrderStatus.PENDING || newOrderStatus === OrderStatus.FAILED)) {
            statusToSave = OrderStatus.PAID // Protect against stale authorized/failed events downgrading a paid order
          }
        }

        const order = await tx.order.upsert({
          where: { tenantId_provider_providerOrderId: { tenantId, provider: 'razorpay', providerOrderId } },
          update: { status: statusToSave },
          create: {
            tenantId,
            customerId,
            provider: 'razorpay',
            providerOrderId,
            amountMinor: amount,
            currency,
            status: statusToSave
          }
        })
        orderId = order.id
      }

      const providerPaymentId = paymentPayload?.id
      let internalPaymentId: string | null = null

      // UPSERT PAYMENT (with State Precedence)
      if (providerPaymentId && customerId) {
        let newPaymentStatus: PaymentStatus = PaymentStatus.PENDING
        if (eventType === 'payment.authorized') newPaymentStatus = PaymentStatus.AUTHORIZED
        if (eventType === 'payment.captured' || eventType === 'subscription.charged') newPaymentStatus = PaymentStatus.CAPTURED
        if (eventType === 'payment.failed') newPaymentStatus = PaymentStatus.FAILED
        if (eventType === 'payment.refunded') newPaymentStatus = PaymentStatus.REFUNDED

        const existingPayment = await tx.payment.findUnique({
          where: { tenantId_provider_providerPaymentId: { tenantId, provider: 'razorpay', providerPaymentId } }
        })

        let statusToSave = newPaymentStatus
        if (existingPayment) {
          const current = existingPayment.status
          if (current === PaymentStatus.REFUNDED) {
            statusToSave = PaymentStatus.REFUNDED
          } else if (current === PaymentStatus.CAPTURED && (newPaymentStatus === PaymentStatus.AUTHORIZED || newPaymentStatus === PaymentStatus.FAILED)) {
            statusToSave = PaymentStatus.CAPTURED // Cannot downgrade CAPTURED
          }
        }

        const payment = await tx.payment.upsert({
          where: { tenantId_provider_providerPaymentId: { tenantId, provider: 'razorpay', providerPaymentId } },
          update: {
            status: statusToSave,
            orderId: orderId || undefined,
            capturedAt: statusToSave === PaymentStatus.CAPTURED ? new Date() : undefined
          },
          create: {
            tenantId,
            customerId,
            orderId,
            provider: 'razorpay',
            providerPaymentId,
            amountMinor: paymentPayload.amount, // Directly use minor unit
            currency: paymentPayload.currency || 'INR',
            status: statusToSave,
            capturedAt: statusToSave === PaymentStatus.CAPTURED ? new Date() : undefined
          }
        })
        internalPaymentId = payment.id

        // PAYMENT ATTEMPTS (Deterministic counting scoped strictly by tenantId & paymentId)
        if (eventType === 'payment.failed') {
          const attemptCount = await tx.paymentAttempt.count({
            where: { tenantId, paymentId: payment.id }
          })

          await tx.paymentAttempt.create({
            data: {
              tenantId,
              customerId,
              paymentId: payment.id,
              orderId,
              attemptNumber: attemptCount + 1,
              amountMinor: paymentPayload.amount,
              currency: paymentPayload.currency || 'INR',
              status: AttemptStatus.FAILED,
              failureCode: paymentPayload.error_code || null,
              failureReason: paymentPayload.error_description || null,
              gatewayResponse: paymentPayload.error_source ? { source: paymentPayload.error_source, step: paymentPayload.error_step } : undefined,
              attemptedAt: new Date()
            }
          })
        }
      }

      // UPSERT SUBSCRIPTION (Authoritative Status Mapping)
      const providerSubscriptionId = subPayload?.id
      if (providerSubscriptionId && customerId) {
        const razorpaySubStatus = subPayload?.status
        let subStatus: SubscriptionStatus = SubscriptionStatus.ACTIVE
        
        if (razorpaySubStatus) {
          if (razorpaySubStatus === 'pending') {
            subStatus = SubscriptionStatus.PAST_DUE
          } else if (['halted', 'cancelled', 'completed', 'expired'].includes(razorpaySubStatus)) {
            subStatus = SubscriptionStatus.CANCELED
          } else if (razorpaySubStatus === 'created' || razorpaySubStatus === 'authenticated') {
            subStatus = SubscriptionStatus.ACTIVE // Treat early states as active
          }
        }

        const existingSub = await tx.subscription.findUnique({
          where: { tenantId_provider_providerSubscriptionId: { tenantId, provider: 'razorpay', providerSubscriptionId } }
        })

        let statusToSave = subStatus
        if (existingSub) {
          const current = existingSub.status
          if (current === SubscriptionStatus.CANCELED) {
            statusToSave = SubscriptionStatus.CANCELED // Terminal
          }
        }

        // Razorpay subscriptions don't always carry amounts in their webhooks directly without the plan/payment
        // So we default to 0 if unknown, or use the accompanying payment amount if available.
        const amount = paymentPayload?.amount || existingSub?.amountMinor || 0

        await tx.subscription.upsert({
          where: { tenantId_provider_providerSubscriptionId: { tenantId, provider: 'razorpay', providerSubscriptionId } },
          update: {
            status: statusToSave,
            amountMinor: amount > 0 ? amount : undefined // Only update if we have a valid amount
          },
          create: {
            tenantId,
            customerId,
            provider: 'razorpay',
            providerSubscriptionId,
            planName: 'Razorpay Plan', 
            amountMinor: amount, 
            billingInterval: 'cycle',
            status: statusToSave
          }
        })
      }

    }, {
      maxWait: 5000,
      timeout: 10000
    })

    // 5. Run deterministic Webhook Feedback Loop to reconcile payment captures and confirmations
    processWebhookFeedback({
      tenantId,
      eventType,
      webhookEventId: savedWebhookEventId,
      payload
    }).catch(err => {
      console.error('[WEBHOOK_FEEDBACK_ERROR]', err)
    })

    // 6. Asynchronously synchronize intelligence without blocking the webhook acknowledgment
    // We use a floating promise to execute the leak detection side-effect safely.
    syncTenantOpportunities(tenantId).catch(err => {
      console.error('[WEBHOOK_SYNC_INSIGHTS_ERROR]', err)
    })

    return { status: 'processed' }

  } catch (err: unknown) {
    const error = err as any
    if (error.message === 'IDEMPOTENCY_DUPLICATE') {
      return { status: 'duplicate' }
    }
    console.error('[RAZORPAY_PROCESSOR_ERROR]', error)
    return { status: 'error', errorType: 'database_error', message: 'Failed to process webhook transaction' }
  }
}
