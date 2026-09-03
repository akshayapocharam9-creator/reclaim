import { PrismaClient } from '@prisma/client'

declare global {
  var prismaGlobal: PrismaClient | undefined
}

/**
 * Robustly sanitizes and encodes connection URLs for PostgreSQL and PgBouncer.
 * Handles:
 * - Surrounding quotes (from .env copy-paste in Vercel)
 * - Leading/trailing whitespace
 * - postgres:// vs postgresql://
 * - Unencoded reserved characters in password (such as '@', '#', '%', '$')
 */
export function sanitizeDatabaseUrl(raw?: string): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined
  let url = raw.trim().replace(/^["']|["']$/g, '').trim()
  if (!url) return undefined

  if (url.startsWith('postgres://')) {
    url = 'postgresql://' + url.slice(11)
  }

  const schemeIndex = url.indexOf('://')
  if (schemeIndex === -1) return url

  const lastAtIndex = url.lastIndexOf('@')
  if (lastAtIndex === -1 || lastAtIndex < schemeIndex) return url

  const authPart = url.slice(schemeIndex + 3, lastAtIndex)
  const rest = url.slice(lastAtIndex)
  const firstColon = authPart.indexOf(':')
  if (firstColon === -1) return url

  const user = authPart.slice(0, firstColon)
  const password = authPart.slice(firstColon + 1)

  const encodedPassword = encodeURIComponent(decodeURIComponent(password))
  return `${url.slice(0, schemeIndex + 3)}${user}:${encodedPassword}${rest}`
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
  get(_target, propKey) {
    const client = getPrismaClient()
    const value = Reflect.get(client, propKey, client)
    return typeof value === 'function' ? value.bind(client) : value
  }
})

export default prisma
