/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { NextRequest } from 'next/server'
import prisma from '../lib/prisma'
import { GET as getOpportunities } from './revenue/opportunities/route'
import { GET as getSummary } from './revenue/summary/route'
import { GET as getDetail } from './revenue/opportunities/[id]/route'

// Simple mock for testing without DB connection
prisma.tenant.findUnique = async (args: unknown) => {
  const queryArgs = args as { where: { id: string } }
  if (queryArgs.where.id === 'valid-tenant') {
    return { id: 'valid-tenant', name: 'Valid', slug: 'valid', createdAt: new Date(), updatedAt: new Date() }
  }
  return null
}

prisma.payment.findMany = async () => []
prisma.checkoutSession.findMany = async () => []
prisma.subscription.findMany = async () => []

async function runTests() {
  console.log('--- Running API Route Tests ---')

  // 1. Missing tenantId returns 400
  const req1 = new NextRequest('http://localhost/api/revenue/opportunities')
  const res1 = await getOpportunities(req1)
  console.assert(res1.status === 400, `Missing tenantId should be 400, got ${res1.status}`)

  // 2. Unknown tenant returns 404
  const req2 = new NextRequest('http://localhost/api/revenue/opportunities?tenantId=invalid')
  const res2 = await getOpportunities(req2)
  console.assert(res2.status === 404, `Unknown tenant should be 404, got ${res2.status}`)

  // 3. Valid tenant returns data (200)
  const req3 = new NextRequest('http://localhost/api/revenue/opportunities?tenantId=valid-tenant')
  const res3 = await getOpportunities(req3)
  console.assert(res3.status === 200, `Valid tenant should be 200, got ${res3.status}`)
  
  const data3 = await res3.json()
  console.assert(Array.isArray(data3.opportunities), 'Response should contain opportunities array')
  console.assert(data3.summary !== undefined, 'Response should contain summary object')

  // 4. Detail API returns 404 with limitation message
  const req4 = new NextRequest('http://localhost/api/revenue/opportunities/123?tenantId=valid-tenant')
  const res4 = await getDetail(req4, { params: Promise.resolve({ id: '123' }) })
  console.assert(res4.status === 404, `Detail API should return 404, got ${res4.status}`)
  const data4 = await res4.json()
  console.assert(data4.limitation === true, 'Detail API should explicitly state architectural limitation')

  // 5. Summary API returns 200
  const req5 = new NextRequest('http://localhost/api/revenue/summary?tenantId=valid-tenant')
  const res5 = await getSummary(req5)
  console.assert(res5.status === 200, `Summary API should return 200, got ${res5.status}`)
  const data5 = await res5.json()
  console.assert(data5.opportunities === undefined, 'Summary API should NOT return full opportunities list')
  console.assert(data5.summary !== undefined, 'Summary API should return summary object')

  console.log('--- All API Route tests passed! ---')
}

runTests().catch(console.error)
