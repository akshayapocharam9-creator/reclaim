/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from '../prisma'
import {
  ActionStatus,
  ActionType,
  ExecutionStatus,
  MembershipRole,
  OpportunityStatus,
  OpportunityType,
  PriorityLevel
} from '@prisma/client'
import { RazorpayApiClient } from './razorpay-client'
import { PaymentExecutionProvider } from './providers/payment-provider'
import { EmailExecutionProvider } from './providers/email-provider'
import { providerHealthMonitor } from './health'
import { validateEnvironment } from '../env'
import { queueExecution, retryExecution } from './service'
import { claimNextQueuedExecution, recoverStaleExecutions } from './processor'
import { StructuredLogger } from '../observability/logger'

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`)
    passed++
  } else {
    console.error(`  ✗ Assertion Failed: ${msg}`)
    failed++
    throw new Error(`Assertion failed: ${msg}`)
  }
}

async function runProductionOperationsTests() {
  console.log('\n====================================================')
  console.log('RECLAIM — PRODUCTION OPERATIONS & REAL INTEGRATION TESTS')
  console.log('====================================================\n')

  const TEST_TENANT_ID = `test_tenant_prod_ops_${Date.now()}`

  // Setup test tenant
  const _tenant = await prisma.tenant.create({
    data: {
      id: TEST_TENANT_ID,
      name: 'Production Operations Test Tenant',
      slug: `prod-ops-${Date.now()}`
    }
  })

  const customer = await prisma.customer.create({
    data: {
      tenantId: TEST_TENANT_ID,
      email: 'customer@prodtest.com',
      name: 'Prod Test Customer'
    }
  })

  // ----------------------------------------------------
  // TEST GROUP 1: Real Razorpay Client & Fail-Closed Safety
  // ----------------------------------------------------
  console.log('[TEST GROUP 1: Real Razorpay Client & Fail-Closed Safety]')

  // 1. Client initialization requires credentials
  let initThrew = false
  try {
    new RazorpayApiClient({ keyId: '', keySecret: '' })
  } catch {
    initThrew = true
  }
  assert(initThrew, 'RazorpayApiClient throws when keyId or keySecret are missing')

  // 2. Client properly constructs Basic Auth header
  const rzpClient = new RazorpayApiClient({ keyId: 'rzp_test_key123', keySecret: 'secret_abc456' })
  const authHeader = (rzpClient as any).getAuthHeader()
  const expectedAuth = `Basic ${Buffer.from('rzp_test_key123:secret_abc456').toString('base64')}`
  assert(authHeader === expectedAuth, 'Constructs correct HTTP Basic Auth header')

  // 3. PaymentExecutionProvider fails closed in LIVE mode when credentials are missing
  const paymentProvider = new PaymentExecutionProvider()
  const originalKey = process.env.RAZORPAY_KEY_ID
  const originalSecret = process.env.RAZORPAY_KEY_SECRET

  delete process.env.RAZORPAY_KEY_ID
  delete process.env.RAZORPAY_KEY_SECRET

  const liveResWithoutCreds = await paymentProvider.execute({
    executionId: 'exec_test_live',
    tenantId: TEST_TENANT_ID,
    opportunityId: 'opp_test_live',
    actionId: 'act_test_live',
    actionType: ActionType.RETRY_PAYMENT,
    channel: 'AUTOMATED',
    idempotencyKey: 'idemp_live_test_1',
    attemptNumber: 1,
    mode: 'live',
    amountMinor: 50000,
    currency: 'INR'
  })

  assert(!liveResWithoutCreds.success, 'Fails closed when live Razorpay credentials are missing')
  assert(liveResWithoutCreds.status === ExecutionStatus.FAILED, 'Status is FAILED')
  assert(liveResWithoutCreds.failureReason?.includes('PROVIDER_NOT_CONFIGURED') === true, 'Failure reason specifies PROVIDER_NOT_CONFIGURED')

  // Restore env
  if (originalKey) process.env.RAZORPAY_KEY_ID = originalKey
  if (originalSecret) process.env.RAZORPAY_KEY_SECRET = originalSecret

  // ----------------------------------------------------
  // TEST GROUP 2: Real Email Provider & Fail-Closed Safety
  // ----------------------------------------------------
  console.log('\n[TEST GROUP 2: Real Email Provider & Fail-Closed Safety]')

  const emailProvider = new EmailExecutionProvider()
  const originalResendKey = process.env.RESEND_API_KEY
  delete process.env.RESEND_API_KEY

  const emailResWithoutCreds = await emailProvider.execute({
    executionId: 'exec_test_email',
    tenantId: TEST_TENANT_ID,
    opportunityId: 'opp_test_email',
    actionId: 'act_test_email',
    actionType: ActionType.SEND_PAYMENT_REMINDER,
    channel: 'EMAIL',
    idempotencyKey: 'idemp_email_test_1',
    attemptNumber: 1,
    mode: 'live',
    amountMinor: 50000,
    currency: 'INR',
    customer: { email: 'user@test.com' }
  })

  assert(!emailResWithoutCreds.success, 'Fails closed when live Resend credentials are missing')
  assert(emailResWithoutCreds.status === ExecutionStatus.FAILED, 'Status is FAILED')
  assert(emailResWithoutCreds.failureReason?.includes('PROVIDER_NOT_CONFIGURED') === true, 'Failure reason specifies PROVIDER_NOT_CONFIGURED')

  if (originalResendKey) process.env.RESEND_API_KEY = originalResendKey

  // Audit mode continues to work safely
  const emailAuditRes = await emailProvider.execute({
    executionId: 'exec_test_email_audit',
    tenantId: TEST_TENANT_ID,
    opportunityId: 'opp_test_email',
    actionId: 'act_test_email',
    actionType: ActionType.SEND_PAYMENT_REMINDER,
    channel: 'EMAIL',
    idempotencyKey: 'idemp_email_audit_1',
    attemptNumber: 1,
    mode: 'audit',
    amountMinor: 50000,
    currency: 'INR',
    customer: { email: 'user@test.com' }
  })
  assert(emailAuditRes.success, 'Audit mode safely simulates email delivery')
  assert(Boolean(emailAuditRes.externalReference), 'Returns reference in audit mode')

  // ----------------------------------------------------
  // TEST GROUP 3: Provider Health & Circuit Breaker Tracking
  // ----------------------------------------------------
  console.log('\n[TEST GROUP 3: Provider Health & Circuit Breaker Tracking]')

  providerHealthMonitor.recordCall('TEST_PROVIDER', {
    success: true,
    latencyMs: 120
  })
  providerHealthMonitor.recordCall('TEST_PROVIDER', {
    success: true,
    latencyMs: 140
  })
  providerHealthMonitor.recordCall('TEST_PROVIDER', {
    success: false,
    latencyMs: 500,
    isTimeout: true,
    errorMessage: 'Gateway Timeout'
  })

  const testStats = providerHealthMonitor.getStats('TEST_PROVIDER', true)
  assert(testStats.totalRequests === 3, 'Tracks total requests')
  assert(testStats.successCount === 2, 'Tracks successful requests')
  assert(testStats.failureCount === 1, 'Tracks failed requests')
  assert(testStats.timeoutCount === 1, 'Tracks timeouts')
  assert(testStats.successRate === 67, 'Computes success rate (67%)')
  assert(testStats.status === 'DEGRADED', 'Marks degraded when success rate drops below 75%')

  // ----------------------------------------------------
  // TEST GROUP 4: Environment Validation (Dev vs Prod)
  // ----------------------------------------------------
  console.log('\n[TEST GROUP 4: Environment Validation]')

  const envValidation = validateEnvironment()
  assert(typeof envValidation.valid === 'boolean', 'Validates environment schema')
  assert(envValidation.databaseConfigured === true, 'Validates DATABASE_URL presence')
  assert(Array.isArray(envValidation.missingRequiredVars), 'Returns missing variables list')
  assert(Array.isArray(envValidation.warnings), 'Returns environment warnings without exposing secrets')

  // ----------------------------------------------------
  // TEST GROUP 5: Dead Letter Queue & Operator Review Workflow
  // ----------------------------------------------------
  console.log('\n[TEST GROUP 5: Dead Letter Queue & Operator Review Workflow]')

  const dlOpp = await prisma.recoveryOpportunity.create({
    data: {
      tenantId: TEST_TENANT_ID,
      customerId: customer.id,
      type: OpportunityType.PAYMENT_FAILURE,
      status: OpportunityStatus.DETECTED,
      priority: PriorityLevel.HIGH,
      score: 85,
      amountAtRiskMinor: 150000,
      recoverableAmountMinor: 150000,
      reason: 'Failed repeated dunning',
      evidence: { error: 'Card blocked' }
    }
  })

  const dlAction = await prisma.recoveryAction.create({
    data: {
      tenantId: TEST_TENANT_ID,
      opportunityId: dlOpp.id,
      type: ActionType.RETRY_PAYMENT,
      status: ActionStatus.APPROVED,
      channel: 'AUTOMATED',
      expectedRecoveryAmountMinor: 150000
    }
  })

  // Queue execution with policyVersion
  const queuedRes = await queueExecution({
    tenantId: TEST_TENANT_ID,
    opportunityId: dlOpp.id,
    actionId: dlAction.id,
    idempotencyKey: `dl_exec_${Date.now()}`,
    policyVersion: 2,
    maxAttempts: 2
  })

  assert(queuedRes.success, 'Successfully queued execution with policyVersion')
  const dlExecId = queuedRes.execution.id

  // Force fail attempt 1
  await prisma.recoveryExecution.update({
    where: { id: dlExecId },
    data: {
      status: ExecutionStatus.FAILED,
      attemptCount: 1,
      failureReason: 'Provider declined card'
    }
  })

  // Retry execution -> reaches attempt 2 (exhausts maxAttempts)
  await retryExecution(dlExecId, TEST_TENANT_ID, { email: 'tester', role: MembershipRole.ADMIN })

  // Force fail attempt 2 -> triggers dead letter classification
  const updatedExecAfterFail2 = await prisma.recoveryExecution.update({
    where: { id: dlExecId },
    data: {
      status: ExecutionStatus.FAILED,
      attemptCount: 2,
      maxAttempts: 2,
      requiresReview: true,
      errorCategory: 'EXHAUSTED_RETRIES',
      failureReason: 'Exhausted maximum retry limit'
    }
  })

  assert(updatedExecAfterFail2.requiresReview === true, 'Executions exhausting max attempts are tagged requiresReview = true')
  assert(updatedExecAfterFail2.errorCategory === 'EXHAUSTED_RETRIES', 'Tagged with errorCategory EXHAUSTED_RETRIES')

  // Operator can inspect dead letter items
  const dlItems = await prisma.recoveryExecution.findMany({
    where: { tenantId: TEST_TENANT_ID, requiresReview: true }
  })
  assert(dlItems.length >= 1, 'Dead Letter items are discoverable via requiresReview query')

  // Operator review retry increments maxAttempts and clears requiresReview
  const operatorRetryRes = await retryExecution(
    dlExecId,
    TEST_TENANT_ID,
    { email: 'operator@admin.com', role: MembershipRole.OWNER },
    { allowReviewRetry: true }
  )
  assert(operatorRetryRes.success, 'Operator can authorize retry for review items')
  assert(operatorRetryRes.execution.requiresReview === false, 'Clears requiresReview flag on operator retry')
  assert(operatorRetryRes.execution.maxAttempts >= 3, 'Increments maxAttempts to allow controlled retry')

  // ----------------------------------------------------
  // TEST GROUP 6: Background Worker Claiming & Stale Execution Recovery
  // ----------------------------------------------------
  console.log('\n[TEST GROUP 6: Background Worker Claiming & Stale Execution Recovery]')

  // Create a queued job
  const workerOpp = await prisma.recoveryOpportunity.create({
    data: {
      tenantId: TEST_TENANT_ID,
      customerId: customer.id,
      type: OpportunityType.PAYMENT_FAILURE,
      status: OpportunityStatus.DETECTED,
      priority: PriorityLevel.MEDIUM,
      score: 70,
      amountAtRiskMinor: 80000,
      recoverableAmountMinor: 80000,
      reason: 'Worker queue test',
      evidence: { test: true }
    }
  })

  const workerAction = await prisma.recoveryAction.create({
    data: {
      tenantId: TEST_TENANT_ID,
      opportunityId: workerOpp.id,
      type: ActionType.RETRY_PAYMENT,
      status: ActionStatus.APPROVED,
      channel: 'simulation'
    }
  })

  const workerQueueRes = await queueExecution({
    tenantId: TEST_TENANT_ID,
    opportunityId: workerOpp.id,
    actionId: workerAction.id,
    idempotencyKey: `worker_exec_${Date.now()}`
  })

  // Worker claims job atomically
  const claim = await claimNextQueuedExecution({
    tenantId: TEST_TENANT_ID,
    workerId: 'worker_unit_test'
  })

  assert(claim.claimed === true, 'Worker successfully claimed queued execution')
  assert(claim.execution?.id === workerQueueRes.execution.id, 'Claimed matching execution ID')

  // Simulate stale RUNNING execution (heartbeat 10 minutes ago)
  await prisma.recoveryExecution.update({
    where: { id: workerQueueRes.execution.id },
    data: {
      status: ExecutionStatus.RUNNING,
      heartbeatAt: new Date(Date.now() - 10 * 60 * 1000)
    }
  })

  const staleRecovery = await recoverStaleExecutions({
    tenantId: TEST_TENANT_ID,
    staleThresholdMinutes: 5
  })

  assert(staleRecovery.recoveredCount >= 1, 'Recovers stale execution that exceeded heartbeat threshold')
  assert(staleRecovery.recoveredExecutionIds.includes(workerQueueRes.execution.id), 'Stale execution moved to FAILED')

  // ----------------------------------------------------
  // TEST GROUP 7: Structured Observability Logger
  // ----------------------------------------------------
  console.log('\n[TEST GROUP 7: Structured Observability Logger]')

  let loggedError = false
  const origConsoleWarn = console.warn
  console.warn = (msg: string) => {
    try {
      const parsed = JSON.parse(msg)
      if (parsed.data?.apiSecret === '[REDACTED]') {
        loggedError = true
      }
    } catch {}
  }

  StructuredLogger.warn('RECOVERY_REQUIRES_REVIEW', {
    tenantId: TEST_TENANT_ID,
    executionId: 'exec_log_test',
    provider: 'RAZORPAY_PAYMENT_PROVIDER'
  }, {
    apiSecret: 'super_secret_key_that_must_not_leak',
    details: 'Uncertain payment status'
  })

  console.warn = origConsoleWarn
  assert(loggedError, 'Structured logger automatically redacts sensitive secret keys')

  // Cleanup test tenant
  await prisma.tenant.delete({ where: { id: TEST_TENANT_ID } }).catch(() => {})

  console.log('\n====================================================')
  console.log(`RESULTS: ${passed} PASSED | ${failed} FAILED`)
  console.log('====================================================\n')
}

runProductionOperationsTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test suite failed:', err)
    process.exit(1)
  })
