import { PrismaClient } from '@prisma/client'

declare global {
  var prismaGlobal: PrismaClient | undefined
}

/**
 * Ensures special characters (like '@') in the database password are safely URL-encoded.
 * Example: postgresql://user:@kshaya@20_3@host:6543/db -> postgresql://user:%40kshaya%4020_3@host:6543/db
 */
function sanitizeDatabaseUrl(url?: string): string | undefined {
  if (!url || typeof url !== 'string') return url
  const match = url.match(/^(postgresql:\/\/[^:]+:)(.*)(@[^@\/]+:[0-9]+\/.*)$/)
  if (match) {
    const [, prefix, password, suffix] = match
    const encodedPassword = password.replace(/@/g, '%40')
    return prefix + encodedPassword + suffix
  }
  return url
}

function getPrismaClient(): PrismaClient {
  if (!globalThis.prismaGlobal) {
    const rawUrl = process.env.DATABASE_URL
    const sanitizedUrl = sanitizeDatabaseUrl(rawUrl)

    globalThis.prismaGlobal = new PrismaClient(
      sanitizedUrl
        ? {
            datasources: {
              db: {
                url: sanitizedUrl
              }
            }
          }
        : undefined
    )
  }
  return globalThis.prismaGlobal
}

// Lazy-initialized proxy ensures new PrismaClient() is never invoked during Next.js build-time module evaluation
const prisma = new Proxy({} as PrismaClient, {
  get(_target, propKey, receiver) {
    const client = getPrismaClient()
    const value = Reflect.get(client, propKey, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  }
})

export default prisma
