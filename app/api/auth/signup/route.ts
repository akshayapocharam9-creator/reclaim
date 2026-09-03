/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { signUpUser } from '../../../lib/auth/service'
import { SESSION_COOKIE_NAME } from '../../../lib/auth/session'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = await signUpUser({
      email: body.email,
      password: body.password,
      name: body.name,
      organizationName: body.organizationName
    })

    if (!result.success || !result.token) {
      return NextResponse.json({ error: result.error || 'Registration failed' }, { status: result.statusCode || 400 })
    }

    const response = NextResponse.json({
      user: result.user,
      tenant: result.tenant,
      role: result.role
    }, { status: 201 })

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
    console.error('[API_AUTH_SIGNUP_ERROR]', error)

    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'An account or organization with these details already exists. Please sign in.' }, { status: 409 })
    }
    if (error?.code === 'P1001' || error?.name === 'PrismaClientInitializationError') {
      return NextResponse.json({ error: 'Database connection failed. Please verify DATABASE_URL is configured in Vercel environment variables.' }, { status: 503 })
    }

    const rawMessage = error?.message || ''
    const safeMessage = rawMessage && !rawMessage.toLowerCase().includes('password') && !rawMessage.toLowerCase().includes('secret')
      ? rawMessage
      : 'Internal registration error'

    return NextResponse.json({ error: safeMessage }, { status: 500 })
  }
}
