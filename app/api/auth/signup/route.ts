import { NextRequest, NextResponse } from 'next/server'
import { signUpUser } from '../../../lib/auth/service'
import { SESSION_COOKIE_NAME } from '../../../lib/auth/session'

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
  } catch (error) {
    console.error('[API_AUTH_SIGNUP_ERROR]', error)
    return NextResponse.json({ error: 'Internal registration error' }, { status: 500 })
  }
}
