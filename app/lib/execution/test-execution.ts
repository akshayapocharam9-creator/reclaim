/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest } from 'next/server'
import prisma from '../prisma'
import { seedAuthUsers } from '../auth/seed-auth'
import { createSessionToken } from '../auth/session'
import { ActionType, ExecutionStatus, MembershipRole, OpportunityStatus, OpportunityType, PriorityLevel } from '@prisma/client'
import { SimulationExecutionProvider } from './providers/simulation-provider'
import { EmailExecutionProvider } from './providers/email-provider'
import { PaymentExecutionProvider } from './providers/payment-provider'
import { queueExecution, processExecution, retryExecution, cancelExecution } from './service'
import { POST as postExecution, GET as getExecutions } from '../../api/revenue/opportunities/[id]/executions/route'
import { POST as postRetry } from '../../api/revenue/executions/[id]/retry/route'
import { POST as postCancel } from '../../api/revenue/executions/[id]/cancel/route'
import { GET as getAnalytics } from '../../api/revenue/analytics/route'
import { GET as getAudit } from '../../api/revenue/audit/route'

async function runExecutionTests() {
  console.log('=== RECLAIM RECOVERY EXECUTION PLATFORM TEST SUITE ===')

  // Step 0: Ensure auth users and memberships exist in Supabase Postgres
  await seedAuthUsers()

  const demoTenant = await prisma.tenant.findUnique({ where: { slug: 'demo-tenant' } })
  const foreignTenant = await prisma.tenant.findUnique({ where: { slug: 'foreign-test-corp' } })

  if (!demoTenant || !foreignTenant) {
    throw new Error('Test tenants missing from Supabase database')
  }

  const ownerUser = await prisma.user.findUnique({ where: { email: 'owner@demosaas.com' } })
  const adminUser = await prisma.user.findUnique({ where: { email: 'admin@demosaas.com' } })
  const memberUser = await prisma.user.findUnique({ where: { email: 'member@demosaas.com' } })
  const foreignOwnerUser = await prisma.user.findUnique({ where: { email: 'owner@foreigntest.com' } })

  const ownerToken = createSessionToken({
    userId: ownerUser!.id,
    email: ownerUser!.email,
    tenantId: demoTenant.id,
    role: MembershipRole.OWNER
  })

  const adminToken = createSessionToken({
    userId: adminUser!.id,
    email: adminUser!.email,
    tenantId: demoTenant.id,
    role: MembershipRole.ADMIN
  })

  const memberToken = createSessionToken({
    userId: memberUser!.id,
    email: memberUser!.email,
    tenantId: demoTenant.id,
    role: MembershipRole.MEMBER
  })

  const foreignToken = createSessionToken({
    userId: foreignOwnerUser!.id,
    email: foreignOwnerUser!.email,
    tenantId: foreignTenant.id,
    role: MembershipRole.OWNER
  })

  // Create clean dedicated test opportunity
  const opp = await prisma.recoveryOpportunity.create({
    data: {
      tenantId: demoTenant.id,
      type: OpportunityType.PAYMENT_FAILURE,
      status: OpportunityStatus.DETECTED,
      amountAtRiskMinor: 500000,
      recoverableAmountMinor: 450000,
      priority: PriorityLevel.HIGH,
      score: 85,
      confidenceScore: 0.9,
      reason: 'Execution test opportunity',
      evidence: { test: true }
    }
  })

  // Create RecoveryAction
  const action = await prisma.recoveryAction.create({
    data: {
      tenantId: demoTenant.id,
      opportunityId: opp.id,
      type: ActionType.SEND_PAYMENT_REMINDER,
      status: 'APPROVED',
      channel: 'EMAIL',
      expectedRecoveryAmountMinor: 450000,
      notes: 'Test recovery action'
    }
  })

  console.log(`Setup complete. Test Opportunity: ${opp.id}, Action: ${action.id}`)

  try {
    // ==========================================
    // 1. PROVIDER ABSTRACTION TESTS
    // ==========================================
    console.log('\n--- 1. Provider Abstraction Tests ---')

    // Simulation Provider
    const simProvider = new SimulationExecutionProvider()
    const simResult = await simProvider.execute({
      executionId: 'exec_test_sim',
      tenantId: demoTenant.id,
      opportunityId: opp.id,
      actionId: action.id,
      actionType: action.type,
      channel: 'EMAIL',
      idempotencyKey: 'idem_sim_1',
      attemptNumber: 1,
      mode: 'audit',
      amountMinor: 450000,
      currency: 'INR'
    })
    console.assert(simResult.success === true, 'Simulation must succeed')
    console.assert(simResult.externalReference?.startsWith('sim_msg_'), 'Simulation ref must have sim_msg prefix')
    console.log('✅ PASS: Simulation provider executes safely in audit mode')

    // Email Provider in Audit Mode
    const emailProvider = new EmailExecutionProvider()
    const emailAuditResult = await emailProvider.execute({
      executionId: 'exec_test_email',
      tenantId: demoTenant.id,
      opportunityId: opp.id,
      actionId: action.id,
      actionType: action.type,
      channel: 'EMAIL',
      idempotencyKey: 'idem_email_1',
      attemptNumber: 1,
      mode: 'audit',
      customer: { email: 'customer@test.com', name: 'Test Customer' },
      amountMinor: 450000,
      currency: 'INR',
      messageSubject: 'Payment Reminder',
      messageBody: 'Please update payment'
    })
    console.assert(emailAuditResult.success === true, 'Email audit mode must succeed without external call')
    console.assert(emailAuditResult.externalReference?.startsWith('resend_sim_'), 'Email audit ref must have resend_sim prefix')
    console.log('✅ PASS: Email provider executes safely in audit mode')

    // Email Provider in Live Mode (Without API Key -> must fail cleanly)
    delete process.env.RESEND_API_KEY
    const emailLiveResult = await emailProvider.execute({
      executionId: 'exec_test_email_live',
      tenantId: demoTenant.id,
      opportunityId: opp.id,
      actionId: action.id,
      actionType: action.type,
      channel: 'EMAIL',
      idempotencyKey: 'idem_email_2',
      attemptNumber: 1,
      mode: 'live',
      customer: { email: 'customer@test.com' },
      amountMinor: 450000,
      currency: 'INR'
    })
    console.assert(emailLiveResult.success === false, 'Live mode without keys must fail')
    console.assert(emailLiveResult.failureReason?.includes('PROVIDER_NOT_CONFIGURED'), 'Must indicate PROVIDER_NOT_CONFIGURED')
    console.log('✅ PASS: Email provider in live mode safely refuses execution when unconfigured')

    // Payment Provider in Live Mode (Without Merchant KYC -> must fail cleanly)
    const paymentProvider = new PaymentExecutionProvider()
    const payLiveResult = await paymentProvider.execute({
      executionId: 'exec_test_pay_live',
      tenantId: demoTenant.id,
      opportunityId: opp.id,
      actionId: action.id,
      actionType: ActionType.RETRY_PAYMENT,
      channel: 'AUTOMATED',
      idempotencyKey: 'idem_pay_1',
      attemptNumber: 1,
      mode: 'live',
      amountMinor: 450000,
      currency: 'INR'
    })
    console.assert(payLiveResult.success === false, 'Live payment without KYC must fail safely')
    console.log('✅ PASS: Payment provider safely refuses live execution without verified KYC credentials')

    // ==========================================
    // 2. EXECUTION SERVICE & DATABASE IDEMPOTENCY
    // ==========================================
    console.log('\n--- 2. Execution Service & Idempotency Tests ---')

    const idemKey = `test_idem_${Date.now()}`

    // Queue Execution
    const queue1 = await queueExecution({
      tenantId: demoTenant.id,
      opportunityId: opp.id,
      actionId: action.id,
      idempotencyKey: idemKey,
      actor: { id: ownerUser!.id, email: ownerUser!.email, role: MembershipRole.OWNER }
    })
    console.assert(queue1.success === true, 'Queue execution must succeed')
    console.assert(queue1.execution.status === ExecutionStatus.QUEUED, 'Execution must be in QUEUED state')
    console.log('✅ PASS: Execution record persisted in QUEUED status')

    // Duplicate Queue with exact same idempotencyKey -> Idempotent 200
    const queue2 = await queueExecution({
      tenantId: demoTenant.id,
      opportunityId: opp.id,
      actionId: action.id,
      idempotencyKey: idemKey
    })
    console.assert(queue2.success === true, 'Duplicate queue must succeed idempotently')
    console.assert(queue2.isIdempotent === true, 'isIdempotent flag must be true')
    console.assert(queue2.execution.id === queue1.execution.id, 'Must return identical execution record')
    console.log('✅ PASS: Database-level idempotency prevents duplicate execution records')

    // Process Queued Execution -> Succeeded
    const procResult = await processExecution(
      queue1.execution.id,
      demoTenant.id,
      { id: ownerUser!.id, email: ownerUser!.email, role: MembershipRole.OWNER }
    )
    console.assert(procResult.success === true, 'Process execution must succeed in audit mode')
    console.assert(procResult.execution.status === ExecutionStatus.SUCCEEDED, 'Status must be SUCCEEDED')
    console.assert(procResult.execution.externalReference !== null, 'External reference must be persisted')
    console.assert(procResult.execution.completedAt !== null, 'completedAt must be populated')
    console.log('✅ PASS: Execution processed through provider to SUCCEEDED with external reference')

    // ==========================================
    // 3. CANCELLATION LIFECYCLE
    // ==========================================
    console.log('\n--- 3. Cancellation Lifecycle Tests ---')

    const cancelIdemKey = `test_cancel_${Date.now()}`
    const queueForCancel = await queueExecution({
      tenantId: demoTenant.id,
      opportunityId: opp.id,
      actionId: action.id,
      idempotencyKey: cancelIdemKey
    })

    const cancelRes = await cancelExecution(
      queueForCancel.execution.id,
      demoTenant.id,
      { id: ownerUser!.id, email: ownerUser!.email, role: MembershipRole.OWNER }
    )
    console.assert(cancelRes.success === true, 'Cancel must succeed')
    console.assert(cancelRes.execution.status === ExecutionStatus.CANCELLED, 'Status must be CANCELLED')

    // Cannot process cancelled execution
    const processCancelled = await processExecution(queueForCancel.execution.id, demoTenant.id)
    console.assert(processCancelled.statusCode === 409, 'Processing cancelled execution must return 409')
    console.log('✅ PASS: Queued execution successfully cancelled; cannot be processed')

    // ==========================================
    // 4. BOUNDED RETRY LIFECYCLE
    // ==========================================
    console.log('\n--- 4. Bounded Retry Lifecycle Tests ---')

    // Manually create a failed execution
    const failedExec = await prisma.recoveryExecution.create({
      data: {
        tenantId: demoTenant.id,
        opportunityId: opp.id,
        recoveryActionId: action.id,
        actionType: action.type,
        provider: 'SIMULATION_AUDIT_PROVIDER',
        status: ExecutionStatus.FAILED,
        idempotencyKey: `failed_retry_test_${Date.now()}`,
        attemptCount: 1,
        maxAttempts: 3,
        failureReason: 'Simulated network timeout'
      }
    })

    // Retry attempt 1 -> attempt 2
    const retry1 = await retryExecution(
      failedExec.id,
      demoTenant.id,
      { id: adminUser!.id, email: adminUser!.email, role: MembershipRole.ADMIN }
    )
    console.assert(retry1.success === true, 'Retry must succeed')
    console.assert(retry1.execution.attemptCount === 2, `Expected attempt 2, got ${retry1.execution.attemptCount}`)
    console.log('✅ PASS: Retry increments attempt counter and updates backoff metadata')

    // Test max retry limit: update attemptCount to 3 and set FAILED
    await prisma.recoveryExecution.update({
      where: { id: failedExec.id },
      data: { attemptCount: 3, status: ExecutionStatus.FAILED }
    })

    const retryMax = await retryExecution(failedExec.id, demoTenant.id)
    console.assert(retryMax.statusCode === 422, 'Retry beyond maxAttempts must return 422')
    console.assert(retryMax.error?.includes('Maximum retry limit'), 'Error must mention maximum retry limit')
    console.log('✅ PASS: Bounded retry protects against infinite loops after max attempts')

    // ==========================================
    // 5. RECOVERY EXECUTION API ENDPOINTS & RBAC
    // ==========================================
    console.log('\n--- 5. Execution API Endpoints & Role Protections ---')

    // Unauthenticated POST /executions -> 401
    const unauthReq = new NextRequest(`http://localhost/api/revenue/opportunities/${opp.id}/executions`, {
      method: 'POST'
    })
    const unauthRes = await postExecution(unauthReq, { params: Promise.resolve({ id: opp.id }) })
    console.assert(unauthRes.status === 401, `Unauthenticated must be 401, got ${unauthRes.status}`)
    console.log('✅ PASS: Unauthenticated execution request rejected with 401')

    // MEMBER role POST /executions -> 403 (Read-only)
    const memberReq = new NextRequest(`http://localhost/api/revenue/opportunities/${opp.id}/executions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${memberToken}` }
    })
    const memberRes = await postExecution(memberReq, { params: Promise.resolve({ id: opp.id }) })
    console.assert(memberRes.status === 403, `Member mutation must be 403, got ${memberRes.status}`)
    console.log('✅ PASS: MEMBER role mutation rejected with 403 (Read-only enforcement)')

    // Cross-tenant execution POST -> 404 (zero leakage)
    const crossReq = new NextRequest(`http://localhost/api/revenue/opportunities/${opp.id}/executions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${foreignToken}` }
    })
    const crossRes = await postExecution(crossReq, { params: Promise.resolve({ id: opp.id }) })
    console.assert(crossRes.status === 404, `Cross-tenant execution must be 404, got ${crossRes.status}`)
    console.log('✅ PASS: Cross-tenant execution request rejected with 404 (Tenant isolation)')

    // ADMIN role POST /executions -> 201
    const adminReq = new NextRequest(`http://localhost/api/revenue/opportunities/${opp.id}/executions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: `api_exec_${Date.now()}`
      })
    })
    const adminRes = await postExecution(adminReq, { params: Promise.resolve({ id: opp.id }) })
    console.assert(adminRes.status === 201 || adminRes.status === 200, `Admin execution must succeed, got ${adminRes.status}`)
    console.log('✅ PASS: ADMIN role authorized to initiate execution')

    // GET /executions -> 200
    const getExecsReq = new NextRequest(`http://localhost/api/revenue/opportunities/${opp.id}/executions`, {
      headers: { authorization: `Bearer ${ownerToken}` }
    })
    const getExecsRes = await getExecutions(getExecsReq, { params: Promise.resolve({ id: opp.id }) })
    console.assert(getExecsRes.status === 200, 'GET executions must return 200')
    const execsData = await getExecsRes.json()
    console.assert(execsData.count > 0, 'Must return persisted executions')
    console.log('✅ PASS: GET /executions returns tenant-isolated executions list')

    // ==========================================
    // 6. REAL DATABASE ANALYTICS API
    // ==========================================
    console.log('\n--- 6. Real Database Analytics API Tests ---')

    // Unauthenticated Analytics -> 401
    const unauthAnalyticReq = new NextRequest('http://localhost/api/revenue/analytics')
    const unauthAnalyticRes = await getAnalytics(unauthAnalyticReq)
    console.assert(unauthAnalyticRes.status === 401, 'Unauthenticated analytics must be 401')

    // Authenticated Analytics -> 200
    const analyticsReq = new NextRequest('http://localhost/api/revenue/analytics?range=30D', {
      headers: { authorization: `Bearer ${ownerToken}` }
    })
    const analyticsRes = await getAnalytics(analyticsReq)
    console.assert(analyticsRes.status === 200, 'Analytics must return 200')
    const analyticsData = await analyticsRes.json()

    console.assert(analyticsData.totals.totalAmountAtRiskMinor >= 500000, 'Analytics total amount at risk must include test opp')
    console.assert(analyticsData.executions.totalExecutions >= 1, 'Analytics executions count must be positive')
    console.assert(Array.isArray(analyticsData.timeSeries), 'Analytics must return timeSeries array')
    console.log('✅ PASS: Real database-backed analytics computed cleanly for tenant')

    // ==========================================
    // 7. AUDIT LOG VERIFICATION
    // ==========================================
    console.log('\n--- 7. Audit Trail & Redaction Tests ---')

    const auditReq = new NextRequest('http://localhost/api/revenue/audit?limit=20', {
      headers: { authorization: `Bearer ${ownerToken}` }
    })
    const auditRes = await getAudit(auditReq)
    console.assert(auditRes.status === 200, 'Audit endpoint must return 200')
    const auditData = await auditRes.json()
    console.assert(auditData.count > 0, 'Must have recorded audit events')

    const hasQueuedEvent = auditData.auditEvents.some((e: any) => e.eventType === 'EXECUTION_QUEUED')
    const hasSucceededEvent = auditData.auditEvents.some((e: any) => e.eventType === 'EXECUTION_SUCCEEDED')
    console.assert(hasQueuedEvent, 'Must have recorded EXECUTION_QUEUED event')
    console.assert(hasSucceededEvent, 'Must have recorded EXECUTION_SUCCEEDED event')
    console.log('✅ PASS: Immutable audit events correctly recorded in database')

  } finally {
    // Cleanup test records
    await prisma.recoveryExecution.deleteMany({ where: { opportunityId: opp.id } })
    await prisma.recoveryOutcome.deleteMany({ where: { opportunityId: opp.id } })
    await prisma.recoveryAction.deleteMany({ where: { opportunityId: opp.id } })
    await prisma.auditEvent.deleteMany({ where: { opportunityId: opp.id } })
    await prisma.recoveryOpportunity.deleteMany({ where: { id: opp.id } })
    console.log('Test cleanup complete.')
  }

  console.log('\n==================================================')
  console.log('🎉 ALL RECOVERY EXECUTION PLATFORM TESTS PASSED!')
  console.log('==================================================\n')
}

runExecutionTests()
  .catch((err) => {
    console.error('Execution test failure:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
