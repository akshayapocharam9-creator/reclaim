import { NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME } from '../../../lib/auth/session'

export async function POST() {
  const response = NextResponse.json({ message: 'Signed out successfully' })
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    expires: new Date(0),
    path: '/'
  })
  return response
}
