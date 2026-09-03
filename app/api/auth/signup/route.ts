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

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({
        error: 'Database configuration missing: DATABASE_URL is not set in Vercel environment variables.'
      }, { status: 503 })
    }

    if (error?.code === 'P2002') {
      return NextResponse.json({
        error: 'An account or organization with these details already exists. Please sign in.'
      }, { status: 409 })
    }

    let message = error?.message || 'Database registration error'
    // Safely redact any database credentials
    message = message.replace(/(postgresql?:\/\/[^:]+:)[^@]+(@)/gi, '$1[REDACTED]$2')

    if (error?.code?.startsWith('P1') || error?.name?.includes('Initialization') || message.includes('DATABASE_URL') || message.includes('database server')) {
      return NextResponse.json({
        error: `Database connection failed (${error?.code || 'INIT_ERROR'}): Please check DATABASE_URL in Vercel. Details: ${message}`
      }, { status: 503 })
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
