import crypto from 'crypto'
import prisma from '../prisma'
import { MembershipRole } from '@prisma/client'
import { createSessionToken } from './session'
import { logAuditEvent } from '../audit/audit-service'
import { seedTenantShowcaseData } from '../tenant/showcase-seed'

/**
 * Secure password hashing using crypto.scryptSync with unique per-user salt.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const derivedKey = crypto.scryptSync(password, salt, 64)
  return `${salt}:${derivedKey.toString('hex')}`
}

/**
 * Validates a password against its stored scrypt hash.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, key] = storedHash.split(':')
    if (!salt || !key) return false
    const derivedKey = crypto.scryptSync(password, salt, 64)
    const keyBuffer = Buffer.from(key, 'hex')
    return crypto.timingSafeEqual(derivedKey, keyBuffer)
  } catch {
    return false
  }
}

export interface AuthResult {
  success: boolean
  error?: string
  statusCode?: number
  user?: {
    id: string
    email: string
    name: string | null
  }
  tenant?: {
    id: string
    name: string
    slug: string
  }
  role?: MembershipRole
  token?: string
}

/**
 * Registers a new user and provisions their organization/tenant as OWNER, or joins an existing tenant.
 */
export async function signUpUser(params: {
  email: string
  password: string
  name?: string
  organizationName?: string
  tenantId?: string
  role?: MembershipRole
}): Promise<AuthResult> {
  const email = params.email.trim().toLowerCase()
  if (!email || !params.password || params.password.length < 6) {
    return { success: false, error: 'Valid email and password (min 6 characters) required', statusCode: 400 }
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return { success: false, error: 'Email is already registered. Please sign in.', statusCode: 409 }
  }

  const passwordHash = hashPassword(params.password)

  let tenantId = params.tenantId
  let role = params.role || MembershipRole.OWNER

  // If no tenantId provided, create a new Tenant
  if (!tenantId) {
    const orgName = params.organizationName || `${email.split('@')[0]}'s Organization`
    const slug = `${orgName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString(36)}`
    const newTenant = await prisma.tenant.create({
      data: {
        name: orgName,
        slug
      }
    })
    tenantId = newTenant.id
    role = MembershipRole.OWNER
  } else {
    // Verify target tenant exists
    const existingTenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!existingTenant) {
      return { success: false, error: 'Target tenant does not exist', statusCode: 404 }
    }
  }

  // Create User and Membership atomically via Prisma nested relation write (pooler/PgBouncer safe)
  const createdUser = await prisma.user.create({
    data: {
      email,
      name: params.name || email.split('@')[0],
      passwordHash,
      memberships: {
        create: {
          tenantId: tenantId!,
          role
        }
      }
    },
    include: {
      memberships: {
        include: {
          tenant: true
        }
      }
    }
  })

  const membership = createdUser.memberships[0]

  const token = createSessionToken({
    userId: createdUser.id,
    email: createdUser.email,
    tenantId: membership.tenantId,
    role: membership.role
  })

  await logAuditEvent({
    tenantId: membership.tenantId,
    actor: { id: createdUser.id, email: createdUser.email, role: membership.role },
    eventType: 'AUTH_SIGNUP',
    entityType: 'User',
    entityId: createdUser.id,
    metadata: { email: createdUser.email, role: membership.role }
  })

  // Automatically initialize verified showcase data for newly provisioned tenants
  if (!params.tenantId) {
    await seedTenantShowcaseData(membership.tenantId, createdUser.email)
  }

  return {
    success: true,
    user: { id: createdUser.id, email: createdUser.email, name: createdUser.name },
    tenant: { id: membership.tenant.id, name: membership.tenant.name, slug: membership.tenant.slug },
    role: membership.role,
    token
  }
}

/**
 * Authenticates user credentials and resolves their primary tenant membership.
 */
export async function signInUser(params: {
  email: string
  password: string
}): Promise<AuthResult> {
  const email = params.email.trim().toLowerCase()
  if (!email || !params.password) {
    return { success: false, error: 'Email and password required', statusCode: 400 }
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      memberships: {
        include: { tenant: true },
        orderBy: { createdAt: 'asc' }
      }
    }
  })

  if (!user || !user.passwordHash || !verifyPassword(params.password, user.passwordHash)) {
    return { success: false, error: 'Invalid email or password', statusCode: 401 }
  }

  if (user.memberships.length === 0) {
    return { success: false, error: 'User does not belong to any tenant organization', statusCode: 403 }
  }

  const primaryMembership = user.memberships[0]

  const token = createSessionToken({
    userId: user.id,
    email: user.email,
    tenantId: primaryMembership.tenantId,
    role: primaryMembership.role
  })

  await logAuditEvent({
    tenantId: primaryMembership.tenantId,
    actor: { id: user.id, email: user.email, role: primaryMembership.role },
    eventType: 'AUTH_SIGNIN',
    entityType: 'User',
    entityId: user.id,
    metadata: { email: user.email, role: primaryMembership.role }
  })

  // Ensure empty tenant has showcase data initialized
  if (primaryMembership.tenantId) {
    await seedTenantShowcaseData(primaryMembership.tenantId, user.email)
  }

  return {
    success: true,
    user: { id: user.id, email: user.email, name: user.name },
    tenant: { id: primaryMembership.tenant.id, name: primaryMembership.tenant.name, slug: primaryMembership.tenant.slug },
    role: primaryMembership.role,
    token
  }
}

/**
 * Ensures a default demo owner account is configured for the demo-tenant.
 */
export async function ensureSeedDemoOwner(demoTenantId?: string) {
  const tenantId = demoTenantId || process.env.RAZORPAY_TENANT_ID || 'cmtkeayky00005qkzmnagbcbb'
  const demoEmail = 'owner@demosaas.com'

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) return null

  let user = await prisma.user.findUnique({ where: { email: demoEmail } })
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: demoEmail,
        name: 'Demo Owner',
        passwordHash: hashPassword('password123')
      }
    })
  }

  let membership = await prisma.membership.findUnique({
    where: {
      userId_tenantId: {
        userId: user.id,
        tenantId: tenant.id
      }
    }
  })

  if (!membership) {
    membership = await prisma.membership.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        role: MembershipRole.OWNER
      }
    })
  }

  return { user, tenant, membership }
}
