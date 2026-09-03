import prisma from '../prisma'
import { MembershipRole } from '@prisma/client'
import { hashPassword } from './service'

export async function seedAuthUsers() {
  console.log('Ensuring auth users and tenant memberships exist in Supabase Postgres...')

  // 1. Resolve Demo Tenant
  const demoTenant = await prisma.tenant.upsert({
    where: { slug: 'demo-tenant' },
    update: {},
    create: {
      name: 'Demo SaaS Corp',
      slug: 'demo-tenant'
    }
  })

  // 2. Demo Owner
  const ownerEmail = 'owner@demosaas.com'
  const ownerUser = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: {
      email: ownerEmail,
      name: 'Demo Owner',
      passwordHash: hashPassword('password123')
    }
  })

  await prisma.membership.upsert({
    where: {
      userId_tenantId: {
        userId: ownerUser.id,
        tenantId: demoTenant.id
      }
    },
    update: { role: MembershipRole.OWNER },
    create: {
      userId: ownerUser.id,
      tenantId: demoTenant.id,
      role: MembershipRole.OWNER
    }
  })

  // 3. Demo Admin
  const adminEmail = 'admin@demosaas.com'
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: 'Demo Admin',
      passwordHash: hashPassword('password123')
    }
  })

  await prisma.membership.upsert({
    where: {
      userId_tenantId: {
        userId: adminUser.id,
        tenantId: demoTenant.id
      }
    },
    update: { role: MembershipRole.ADMIN },
    create: {
      userId: adminUser.id,
      tenantId: demoTenant.id,
      role: MembershipRole.ADMIN
    }
  })

  // 4. Demo Member (Read-only)
  const memberEmail = 'member@demosaas.com'
  const memberUser = await prisma.user.upsert({
    where: { email: memberEmail },
    update: {},
    create: {
      email: memberEmail,
      name: 'Demo Member',
      passwordHash: hashPassword('password123')
    }
  })

  await prisma.membership.upsert({
    where: {
      userId_tenantId: {
        userId: memberUser.id,
        tenantId: demoTenant.id
      }
    },
    update: { role: MembershipRole.MEMBER },
    create: {
      userId: memberUser.id,
      tenantId: demoTenant.id,
      role: MembershipRole.MEMBER
    }
  })

  // 5. User Without Membership (For 403 test)
  const noOrgEmail = 'noorg@example.com'
  await prisma.user.upsert({
    where: { email: noOrgEmail },
    update: {},
    create: {
      email: noOrgEmail,
      name: 'No Org User',
      passwordHash: hashPassword('password123')
    }
  })

  // 6. Foreign Tenant and Foreign Owner (For cross-tenant isolation tests)
  const foreignTenant = await prisma.tenant.upsert({
    where: { slug: 'foreign-test-corp' },
    update: {},
    create: {
      name: 'Foreign Test Corp',
      slug: 'foreign-test-corp'
    }
  })

  const foreignOwnerEmail = 'owner@foreigntest.com'
  const foreignOwnerUser = await prisma.user.upsert({
    where: { email: foreignOwnerEmail },
    update: {},
    create: {
      email: foreignOwnerEmail,
      name: 'Foreign Owner',
      passwordHash: hashPassword('password123')
    }
  })

  await prisma.membership.upsert({
    where: {
      userId_tenantId: {
        userId: foreignOwnerUser.id,
        tenantId: foreignTenant.id
      }
    },
    update: { role: MembershipRole.OWNER },
    create: {
      userId: foreignOwnerUser.id,
      tenantId: foreignTenant.id,
      role: MembershipRole.OWNER
    }
  })

  console.log('✅ Auth users and tenant memberships successfully seeded:')
  console.log(`- Demo Tenant (${demoTenant.id}):`)
  console.log(`  * Owner: ${ownerEmail}`)
  console.log(`  * Admin: ${adminEmail}`)
  console.log(`  * Member: ${memberEmail}`)
  console.log(`- Foreign Tenant (${foreignTenant.id}):`)
  console.log(`  * Foreign Owner: ${foreignOwnerEmail}`)
  console.log(`- Unaffiliated User: ${noOrgEmail}`)

  return {
    demoTenant,
    foreignTenant,
    ownerUser,
    adminUser,
    memberUser,
    foreignOwnerUser
  }
}

if (require.main === module) {
  seedAuthUsers()
    .catch(console.error)
    .finally(() => prisma.$disconnect())
}
