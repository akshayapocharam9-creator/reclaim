import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { MembershipRole } from '@prisma/client'

export interface SessionPayload {
  userId: string
  email: string
  tenantId: string
  role: MembershipRole
  exp: number
}

const SESSION_SECRET = process.env.AUTH_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET || 'reclaim-secure-auth-secret-2026'
export const SESSION_COOKIE_NAME = 'reclaim_session'

/**
 * Creates a signed session token: base64url(payload) + '.' + hmac(signature)
 */
export function createSessionToken(payload: Omit<SessionPayload, 'exp'>, expiresInSeconds: number = 7 * 24 * 60 * 60): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  }

  const payloadEncoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url')
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payloadEncoded)
    .digest('base64url')

  return `${payloadEncoded}.${signature}`
}

/**
 * Verifies a signed session token and checks expiry.
 */
export function verifySessionToken(token: string): SessionPayload | null {
  if (!token || typeof token !== 'string') return null

  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [payloadEncoded, signature] = parts

  const expectedSignature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payloadEncoded)
    .digest('base64url')

  // Timing safe comparison to prevent timing attacks
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null
  }

  try {
    const payload: SessionPayload = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf-8'))
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && payload.exp < now) {
      return null // Expired
    }
    return payload
  } catch {
    return null
  }
}

/**
 * Extracts session payload from a NextRequest or standard Request.
 * Inspects both HTTP cookie (`reclaim_session`) and Authorization header (`Bearer <token>`).
 */
export function getSessionFromRequest(request: NextRequest | Request): SessionPayload | null {
  // 1. Check Authorization Bearer header
  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim()
    const verified = verifySessionToken(token)
    if (verified) return verified
  }

  // 2. Check Cookie
  if ('cookies' in request && typeof (request as NextRequest).cookies?.get === 'function') {
    const cookieToken = (request as NextRequest).cookies.get(SESSION_COOKIE_NAME)?.value
    if (cookieToken) {
      const verified = verifySessionToken(cookieToken)
      if (verified) return verified
    }
  }

  // Fallback to raw Cookie header parsing
  const cookieHeader = request.headers.get('cookie')
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map(c => c.trim())
    for (const cookie of cookies) {
      if (cookie.startsWith(`${SESSION_COOKIE_NAME}=`)) {
        const token = cookie.substring(SESSION_COOKIE_NAME.length + 1)
        const verified = verifySessionToken(token)
        if (verified) return verified
      }
    }
  }

  return null
}
