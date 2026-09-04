/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { processRazorpayWebhook } from '../../../lib/webhooks/razorpay-processor'

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    
    // 1. Signature Verification
    const signature = request.headers.get('x-razorpay-signature')
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET

    if (!signature || !secret) {
      console.warn('[WEBHOOK_RAZORPAY] Missing signature or configured secret.')
      return NextResponse.json({ error: 'Unauthorized', message: 'Missing signature' }, { status: 401 })
    }

    const expectedSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    
    // Timing-safe comparison to prevent timing attacks
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8')
    const signatureBuffer = Buffer.from(signature, 'utf8')

    if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
      console.warn('[WEBHOOK_RAZORPAY] Invalid signature.')
      return NextResponse.json({ error: 'Unauthorized', message: 'Invalid signature' }, { status: 401 })
    }

    // 2. Parse Payload
    let payload: any
    try {
      payload = JSON.parse(rawBody)
    } catch {
      console.warn('[WEBHOOK_RAZORPAY] Invalid JSON payload.')
      return NextResponse.json({ error: 'Bad Request', message: 'Invalid JSON payload' }, { status: 400 })
    }

    // 3. Extract Event ID for Idempotency
    // Razorpay sends 'x-razorpay-event-id' header or 'event_id' in body
    const eventId = request.headers.get('x-razorpay-event-id') || payload?.event_id || payload?.id
    if (!eventId) {
      console.warn('[WEBHOOK_RAZORPAY] Missing event ID in header or body.')
      return NextResponse.json({ error: 'Bad Request', message: 'Missing event ID' }, { status: 400 })
    }

    // 4. Multi-Tenant Resolution (Query param, header, or fallback environment variable)
    const tenantId = request.nextUrl.searchParams.get('tenantId') || request.headers.get('x-tenant-id') || process.env.RAZORPAY_TENANT_ID
    if (!tenantId) {
      console.warn('[WEBHOOK_RAZORPAY] Server configuration error: Missing tenant ID in query param, header, or RAZORPAY_TENANT_ID.')
      return NextResponse.json({ error: 'Server Configuration Error', message: 'Missing tenant configuration' }, { status: 500 })
    }

    // 5. Process Event safely
    const result = await processRazorpayWebhook(tenantId, eventId, payload)
    
    if (result.status === 'duplicate') {
      return NextResponse.json({ message: 'Idempotent event already processed' }, { status: 200 })
    }
    if (result.status === 'unsupported') {
      return NextResponse.json({ message: 'Event type unsupported but acknowledged', event: payload.event }, { status: 200 })
    }
    if (result.status === 'error') {
      if (result.errorType === 'tenant_not_found') {
        return NextResponse.json({ error: 'Not Found', message: 'Configured tenant does not exist' }, { status: 404 })
      }
      throw new Error(result.message) // Handled by generic 500
    }

    return NextResponse.json({ message: 'Webhook processed successfully' }, { status: 200 })

  } catch (error) {
    console.error('[WEBHOOK_RAZORPAY_ERROR] Unexpected error processing webhook:', error)
    return NextResponse.json({ error: 'Internal Server Error', message: 'Unexpected server error' }, { status: 500 })
  }
}
