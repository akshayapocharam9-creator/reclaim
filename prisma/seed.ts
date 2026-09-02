import { PrismaClient, OrderStatus, PaymentStatus, AttemptStatus, SessionStatus, SubscriptionStatus } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding RECLAIM database with foundational demo data...')

  // 1. Demo Tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-tenant' },
    update: {},
    create: {
      name: 'Demo SaaS Corp',
      slug: 'demo-tenant',
    },
  })

  // Clear existing (excluding Tenant)
  await prisma.webhookEvent.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.recoveryOutcome.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.recoveryAction.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.recoveryOpportunity.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.checkoutSession.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.paymentAttempt.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.payment.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.order.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.subscription.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.customer.deleteMany({ where: { tenantId: tenant.id } })

  // 2. Customers
  const customer1 = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      name: 'Acme Corp',
      email: 'billing@acme.example.com',
      provider: 'razorpay',
      providerCustomerId: 'cust_Acme123',
    }
  })

  const customer2 = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      name: 'Globex Inc',
      email: 'finance@globex.example.com',
      provider: 'razorpay',
      providerCustomerId: 'cust_Globex456',
    }
  })

  const customer3 = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      name: 'Initech',
      email: 'peter@initech.example.com',
      provider: 'razorpay',
      providerCustomerId: 'cust_Initech789',
    }
  })

  // 3. Successful Payment Scenario (Globex)
  const orderSuccess = await prisma.order.create({
    data: {
      tenantId: tenant.id,
      customerId: customer2.id,
      amountMinor: 2500000, // 25,000 INR
      currency: 'INR',
      status: OrderStatus.PAID,
      provider: 'razorpay',
      providerOrderId: 'order_success_01'
    }
  })

  const paymentSuccess = await prisma.payment.create({
    data: {
      tenantId: tenant.id,
      customerId: customer2.id,
      orderId: orderSuccess.id,
      amountMinor: 2500000,
      currency: 'INR',
      status: PaymentStatus.CAPTURED,
      provider: 'razorpay',
      providerPaymentId: 'pay_success_01',
      capturedAt: new Date(),
    }
  })

  await prisma.paymentAttempt.create({
    data: {
      tenantId: tenant.id,
      customerId: customer2.id,
      paymentId: paymentSuccess.id,
      orderId: orderSuccess.id,
      attemptNumber: 1,
      amountMinor: 2500000,
      status: AttemptStatus.SUCCESS,
      attemptedAt: new Date(),
    }
  })

  // 4. Repeated Payment Failure Scenario (Acme)
  const orderFail = await prisma.order.create({
    data: {
      tenantId: tenant.id,
      customerId: customer1.id,
      amountMinor: 1500000, // 15,000 INR
      currency: 'INR',
      status: OrderStatus.FAILED,
      provider: 'razorpay',
      providerOrderId: 'order_fail_01'
    }
  })

  const paymentFail = await prisma.payment.create({
    data: {
      tenantId: tenant.id,
      customerId: customer1.id,
      orderId: orderFail.id,
      amountMinor: 1500000,
      currency: 'INR',
      status: PaymentStatus.FAILED,
      provider: 'razorpay',
      providerPaymentId: 'pay_fail_01',
    }
  })

  // Attempt 1
  await prisma.paymentAttempt.create({
    data: {
      tenantId: tenant.id,
      customerId: customer1.id,
      paymentId: paymentFail.id,
      orderId: orderFail.id,
      attemptNumber: 1,
      amountMinor: 1500000,
      status: AttemptStatus.FAILED,
      failureCode: 'insufficient_funds',
      failureReason: 'Insufficient funds in the account.',
      attemptedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2), // 2 days ago
    }
  })

  // Attempt 2 (Repeated Failure)
  await prisma.paymentAttempt.create({
    data: {
      tenantId: tenant.id,
      customerId: customer1.id,
      paymentId: paymentFail.id,
      orderId: orderFail.id,
      attemptNumber: 2,
      amountMinor: 1500000,
      status: AttemptStatus.FAILED,
      failureCode: 'authentication_failed',
      failureReason: 'Customer failed 3D secure authentication.',
      attemptedAt: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
    }
  })

  // 5. Checkout Abandonment Scenario (Initech)
  const sessionAbandoned = await prisma.checkoutSession.create({
    data: {
      tenantId: tenant.id,
      customerId: customer3.id,
      provider: 'razorpay',
      providerCheckoutSessionId: 'cs_abandoned_01',
      amountMinor: 5000000, // 50,000 INR
      currency: 'INR',
      status: SessionStatus.ABANDONED,
      startedAt: new Date(Date.now() - 1000 * 60 * 60 * 4), // 4 hours ago
      abandonedAt: new Date(Date.now() - 1000 * 60 * 60 * 3),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 20),
    }
  })

  // 6. Subscriptions
  // Active
  await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      customerId: customer2.id,
      provider: 'razorpay',
      providerSubscriptionId: 'sub_active_01',
      planName: 'Enterprise Plan',
      amountMinor: 10000000, // 100,000 INR
      currency: 'INR',
      billingInterval: 'year',
      status: SubscriptionStatus.ACTIVE,
      nextChargeAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      startedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 300),
    }
  })

  // Past Due (Acme)
  await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      customerId: customer1.id,
      provider: 'razorpay',
      providerSubscriptionId: 'sub_past_due_01',
      planName: 'Pro Plan',
      amountMinor: 500000, // 5,000 INR
      currency: 'INR',
      billingInterval: 'month',
      status: SubscriptionStatus.PAST_DUE,
      nextChargeAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5), // Missed 5 days ago
      startedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 65),
    }
  })

  console.log('Seed completed successfully. Foundation demo data injected.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
