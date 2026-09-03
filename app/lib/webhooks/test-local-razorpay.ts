/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto'
import prisma from '../../lib/prisma'

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'local_dev_secret_123'
const TENANT_ID = process.env.RAZORPAY_TENANT_ID!

async function runLocalSimulation() {
  console.log('=== LIVE LOCAL PIPELINE VERIFICATION ===')

  const eventId = `evt_live_sim_${Date.now()}`
  const paymentId = `pay_live_sim_${Date.now()}`
  
  const payload = {
    event: 'payment.failed',
    payload: {
      payment: {
        entity: {
          id: paymentId,
          amount: 850000, // 8,500 INR
          currency: 'INR',
          order_id: `order_sim_${Date.now()}`,
          customer_id: 'cust_Acme123', // Matches Acme Corp from seed data
          error_code: 'BAD_REQUEST_ERROR',
          error_description: 'Simulated payment failure (Insufficient Funds)',
          error_source: 'issuer',
          error_step: 'payment_authentication'
        }
      }
    },
    created_at: Math.floor(Date.now() / 1000)
  }

  const rawBody = JSON.stringify(payload)
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')

  console.log('\n[1] Sending first webhook request (Initial failure)...')
  
  let responseText1 = ''
  let status1 = 200

  try {
    const response1 = await fetch('http://localhost:3000/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId
      },
      body: rawBody
    })
    status1 = response1.status
    responseText1 = await response1.text()
  } catch {
    console.log('Dev server not running on localhost:3000, invoking POST route handler directly...')
    const { NextRequest } = await import('next/server')
    const { POST: webhookHandler } = await import('../../api/webhooks/razorpay/route')
    const directReq = new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId
      },
      body: rawBody
    })
    const directRes = await webhookHandler(directReq)
    status1 = directRes.status
    responseText1 = JSON.stringify(await directRes.json())
  }

  console.log(`HTTP Status: ${status1}`)
  console.log(`Response: ${responseText1}`)

  if (status1 !== 200) {
    throw new Error('Webhook 1 failed!')
  }

  console.log('\n[2] Giving async intelligence pipeline a moment to commit to DB...')
  let payment = null
  let opp = null
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    payment = await prisma.payment.findFirst({ where: { providerPaymentId: paymentId } })
    if (payment) {
      opp = await prisma.recoveryOpportunity.findFirst({ where: { paymentId: payment.id } })
      if (opp) break
    }
  }

  console.log('\n[3] Verifying Database State...')
  const weCount = await prisma.webhookEvent.count({ where: { eventId } })
  console.log(`WebhookEvent persisted count: ${weCount}`)
  console.log(`Payment persisted: ${payment ? 'YES' : 'NO'}, Status: ${payment?.status}`)
  console.log(`RecoveryOpportunity persisted: ${opp ? 'YES' : 'NO'}, Status: ${opp?.status}, AmountAtRisk: ${opp?.amountAtRiskMinor}`)

  if (weCount !== 1 || !payment || !opp) {
    throw new Error('Database verification failed! Missing expected records.')
  }

  console.log('\n[4] Sending duplicate webhook request (Idempotency test)...')
  let responseText2 = ''
  let status2 = 200

  try {
    const response2 = await fetch('http://localhost:3000/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId // EXACT same event ID
      },
      body: rawBody
    })
    status2 = response2.status
    responseText2 = await response2.text()
  } catch {
    const { NextRequest } = await import('next/server')
    const { POST: webhookHandler } = await import('../../api/webhooks/razorpay/route')
    const directReq = new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId
      },
      body: rawBody
    })
    const directRes = await webhookHandler(directReq)
    status2 = directRes.status
    responseText2 = JSON.stringify(await directRes.json())
  }

  console.log(`HTTP Status: ${status2}`)
  console.log(`Response: ${responseText2}`)

  console.log('\n[5] Verifying Idempotency in DB...')
  await new Promise(resolve => setTimeout(resolve, 1000))

  const weCount2 = await prisma.webhookEvent.count({ where: { eventId } })
  console.log(`WebhookEvent persisted count (should still be 1): ${weCount2}`)

  const oppCount2 = await prisma.recoveryOpportunity.count({ where: { paymentId: payment.id } })
  console.log(`RecoveryOpportunity count (should still be 1): ${oppCount2}`)

  if (weCount2 !== 1 || oppCount2 !== 1) {
    throw new Error('Idempotency failure! Duplicate records detected.')
  }

  console.log('\n[6] Verifying API Exposure...')
  const { createSessionToken } = await import('../auth/session')
  const owner = await prisma.user.findUnique({ where: { email: 'owner@demosaas.com' } })
  const token = createSessionToken({
    userId: owner!.id,
    email: owner!.email,
    tenantId: TENANT_ID,
    role: 'OWNER' as any
  })

  let apiData: any
  try {
    const apiRes = await fetch(`http://localhost:3000/api/revenue/opportunities`, {
      headers: { authorization: `Bearer ${token}` }
    })
    apiData = await apiRes.json()
  } catch {
    const { NextRequest } = await import('next/server')
    const { GET: getOpps } = await import('../../api/revenue/opportunities/route')
    const directApiReq = new NextRequest('http://localhost:3000/api/revenue/opportunities', {
      headers: { authorization: `Bearer ${token}` }
    })
    const directApiRes = await getOpps(directApiReq)
    apiData = await directApiRes.json()
  }

  const foundInApi = apiData.opportunities?.find((o: any) => o.amount === 8500) // 850000 minor = 8500 major
  console.log(`Found in API / Dashboard response: ${foundInApi ? 'YES' : 'NO'}`)

  if (!foundInApi) {
    throw new Error('API hydration failure! Opportunity not returned by API.')
  }

  console.log('\n=== ALL TESTS PASSED ===')
}

runLocalSimulation()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect()
  })
