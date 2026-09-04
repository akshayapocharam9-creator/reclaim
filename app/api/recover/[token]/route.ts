/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { getPublicRecoveryDetails, resolvePaymentWithToken } from '../../../lib/recovery/token-service'

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
  'Surrogate-Control': 'no-store'
}

/**
 * GET /api/recover/[token]
 * Public, unauthenticated endpoint for fetching customer-safe invoice and payment details.
 * Masks PII, verifies token validity and expiration, and never leaks internal metadata or credentials.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> | { token: string } }
) {
  try {
    const params = await Promise.resolve(context.params)
    const token = params.token

    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { success: false, error: 'INVALID_TOKEN', message: 'Recovery token is required.' },
        { status: 400, headers: NO_CACHE_HEADERS }
      )
    }

    const details = await getPublicRecoveryDetails(token)

    if (!details.valid) {
      if (details.alreadyResolved) {
        return NextResponse.json(
          {
            success: true,
            alreadyResolved: true,
            merchantName: details.merchantName,
            customerName: details.customerName,
            amountMinor: details.amountMinor,
            amountFormatted: details.amountFormatted,
            status: details.status,
            resolutionReceipt: details.resolutionReceipt,
            message: details.message || 'This payment has already been settled.'
          },
          { status: 200, headers: NO_CACHE_HEADERS }
        )
      }

      const statusCode = details.error === 'EXPIRED' || details.error === 'REVOKED' ? 410 : 404
      return NextResponse.json(
        {
          success: false,
          error: details.error,
          message: details.message
        },
        { status: statusCode, headers: NO_CACHE_HEADERS }
      )
    }

    return NextResponse.json(
      {
        success: true,
        merchantName: details.merchantName,
        customerName: details.customerName,
        maskedEmail: details.maskedEmail,
        amountMinor: details.amountMinor,
        amountFormatted: details.amountFormatted,
        currency: details.currency,
        reason: details.reason,
        opportunityType: details.opportunityType,
        status: details.status,
        expiresAt: details.expiresAt,
        orderReference: details.orderReference,
        mode: details.mode
      },
      { status: 200, headers: NO_CACHE_HEADERS }
    )
  } catch (error: any) {
    console.error('Error in GET /api/recover/[token]:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'An error occurred while loading payment recovery details. Please try again later.'
      },
      { status: 500, headers: NO_CACHE_HEADERS }
    )
  }
}

/**
 * POST /api/recover/[token]
 * Public endpoint for resolving payment through the customer portal.
 * Atomically marks the token consumed, records a verified RecoveryOutcome,
 * transitions the opportunity to RECOVERED, and generates a digital receipt.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> | { token: string } }
) {
  try {
    const params = await Promise.resolve(context.params)
    const token = params.token

    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { success: false, error: 'INVALID_TOKEN', message: 'Recovery token is required.' },
        { status: 400, headers: NO_CACHE_HEADERS }
      )
    }

    // Parse optional body
    let body: Record<string, any> = {}
    try {
      body = await request.json()
    } catch {
      // Body is optional
    }

    // Extract client IP and User Agent for security auditing
    const forwardedFor = request.headers.get('x-forwarded-for')
    const actorIp = forwardedFor ? forwardedFor.split(',')[0].trim() : request.headers.get('x-real-ip') || 'unknown_ip'
    const userAgent = request.headers.get('user-agent') || 'unknown_ua'

    const resolution = await resolvePaymentWithToken(token, {
      paymentMethod: body.paymentMethod || 'CUSTOMER_PORTAL',
      notes: body.notes,
      actorIp,
      userAgent
    })

    return NextResponse.json(resolution, {
      status: resolution.statusCode,
      headers: NO_CACHE_HEADERS
    })
  } catch (error: any) {
    console.error('Error in POST /api/recover/[token]:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'An error occurred while processing payment resolution. Please try again later.'
      },
      { status: 500, headers: NO_CACHE_HEADERS }
    )
  }
}