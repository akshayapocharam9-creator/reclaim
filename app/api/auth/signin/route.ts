/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { signInUser } from '../../../lib/auth/service'
import { SESSION_COOKIE_NAME } from '../../../lib/auth/session'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = await signInUser({
      email: body.email,
      password: body.password
    })

    if (!result.success || !result.token) {
      return NextResponse.json({ error: result.error || 'Authentication failed' }, { status: result.statusCode || 401 })
    }

    const response = NextResponse.json({
      user: result.user,
      tenant: result.tenant,
      role: result.role
    })

    // Set secure HTTP-only session cookie
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: result.token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 // 7 days
    })

    return response
  } catch (error: any) {
    console.error('[API_AUTH_SIGNIN_ERROR]', error)

    if (error?.code === 'P1001' || error?.name === 'PrismaClientInitializationError') {
      return NextResponse.json({ error: 'Database connection failed. Please verify DATABASE_URL in Vercel environment variables.' }, { status: 503 })
    }

    const rawMessage = error?.message || ''
    const safeMessage = rawMessage && !rawMessage.toLowerCase().includes('password') && !rawMessage.toLowerCase().includes('secret')
      ? rawMessage
      : 'Internal authentication error'

    return NextResponse.json({ error: safeMessage }, { status: 500 })
  }
}
