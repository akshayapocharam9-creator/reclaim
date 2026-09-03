import { NextRequest } from 'next/server'
import prisma from '../prisma'
import { MembershipRole } from '@prisma/client'
import { getSessionFromRequest } from './session'

export interface AuthenticatedTenantContext {
  success: true
  user: {
    id: string
    email: string
    name: string | null
  }
  tenant: {
    id: string
    name: string
    slug: string
  }
  tenantId: string
  role: MembershipRole
}

export interface AuthFailure {
  success: false
  error: string
  statusCode: 401 | 403
}

export type AuthContextResult = AuthenticatedTenantContext | AuthFailure

/**
 * Resolves the authenticated user and their authorized tenant strictly from the server-side session.
 * Rejects unauthenticated requests with 401.
 * Rejects requests without valid tenant membership with 403.
 * Client-supplied tenantId query/body parameters are strictly ignored.
 */
export async function getAuthenticatedTenantContext(request: NextRequest | Request): Promise<AuthContextResult> {
  const session = getSessionFromRequest(request)

  if (!session) {
    return {
      success: false,
      error: 'Unauthorized: Authentication required',
      statusCode: 401
    }
  }

  // Verify user and active tenant membership in database
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      memberships: {
        where: { tenantId: session.tenantId },
        include: { tenant: true }
      }
    }
  })

  if (!user) {
    return {
      success: false,
      error: 'Unauthorized: User account not found',
      statusCode: 401
    }
  }

  if (user.memberships.length === 0) {
    return {
      success: false,
      error: 'Forbidden: You do not have access to this tenant organization',
      statusCode: 403
    }
  }

  const activeMembership = user.memberships[0]

  return {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name
    },
    tenant: {
      id: activeMembership.tenant.id,
      name: activeMembership.tenant.name,
      slug: activeMembership.tenant.slug
    },
    tenantId: activeMembership.tenant.id,
    role: activeMembership.role
  }
}

/**
 * Enforces role-based access control.
 * Rejects with 403 Forbidden if user role is not in allowedRoles.
 */
export function requireRole(
  context: AuthenticatedTenantContext,
  allowedRoles: MembershipRole[]
): { allowed: true } | { allowed: false; error: string; statusCode: 403 } {
  if (!allowedRoles.includes(context.role)) {
    return {
      allowed: false,
      error: `Forbidden: Action requires ${allowedRoles.join(' or ')} permissions. Your role: ${context.role}`,
      statusCode: 403
    }
  }
  return { allowed: true }
}
