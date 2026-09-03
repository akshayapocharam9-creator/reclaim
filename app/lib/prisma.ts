import { PrismaClient } from '@prisma/client'

declare global {
  var prismaGlobal: PrismaClient | undefined
}

function getPrismaClient(): PrismaClient {
  if (!globalThis.prismaGlobal) {
    globalThis.prismaGlobal = new PrismaClient()
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
