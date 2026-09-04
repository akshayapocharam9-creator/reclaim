/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from '../prisma'
import {
  createRecoveryToken,
  verifyRecoveryToken,
  getPublicRecoveryDetails,
  resolvePaymentWithToken,
  revokeRecoveryToken,
  hashToken,
  maskEmail,
  sanitizeCustomerReason,
  formatCurrencyAmount
} from '../recovery/token-service'
import { GET as getRecoverRoute, POST as postRecoverRoute } from '../../api/recover/[token]/route'
import { OpportunityType, OpportunityStatus, PriorityLevel, OutcomeType, ActionStatus } from '@prisma/client'
import { NextRequest } from 'next/server'
import assert from 'assert'

function createMockRequest(url: string, method: string = 'GET', body?: any): NextRequest {
  return new NextRequest(new URL(url, 'https://reclaim-tau-eight.vercel.app'), {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.42',
      'user-agent': 'Mozilla/5.0 (Customer-Test-Agent)'
    },
    body: body ? JSON.stringify(body) : undefined
  })
}

async function runCustomerRecoveryTests() {
  console.log('=== RUNNING CUSTOMER RECOVERY PORTAL & PAYMENT RESOLUTION TEST SUITE ===\n')

  // Setup Test Tenant A
  const tenantA = await prisma.tenant.upsert({
    where: { slug: 'test-recovery-tenant-a' },
    update: {},
    create: { name: 'Acme SaaS Corp', slug: 'test-recovery-tenant-a' }
  })

  // Setup Test Tenant B
  const tenantB = await prisma.tenant.upsert({
    where: { slug: 'test-recovery-tenant-b' },
    update: {},
    create: { name: 'Beta Cloud Ltd', slug: 'test-recovery-tenant-b' }
  })

  // Setup Test Customer A
  const customerA = await prisma.customer.create({
    data: {
      tenantId: tenantA.id,
      email: 'customer.alex@example.com',
      name: 'Alex Johnson',
      phone: '+919876543210'
    }
  })

  // Setup Test Opportunity A
  const opportunityA = await prisma.recoveryOpportunity.create({
    data: {
      tenantId: tenantA.id,
      customerId: customerA.id,
      type: OpportunityType.PAYMENT_FAILURE,
      status: OpportunityStatus.DETECTED,
      amountAtRiskMinor: 499900, // ₹4,999.00
      recoverableAmountMinor: 499900,
      priority: PriorityLevel.HIGH,
      score: 85,
      reason: 'GATEWAY_ERROR: Insufficient funds in account',
      evidence: { gateway: 'razorpay', error_code: 'BAD_REQUEST_ERROR' }
    }
  })

  // Setup linked action for Opportunity A
  const actionA = await prisma.recoveryAction.create({
    data: {
      tenantId: tenantA.id,
      opportunityId: opportunityA.id,
      type: 'SEND_PAYMENT_REMINDER',
      status: ActionStatus.PENDING,
      channel: 'EMAIL'
    }
  })

  // Setup Test Opportunity B
  const opportunityB = await prisma.recoveryOpportunity.create({
    data: {
      tenantId: tenantB.id,
      type: OpportunityType.SUBSCRIPTION_FAILURE,
      status: OpportunityStatus.DETECTED,
      amountAtRiskMinor: 129900, // ₹1,299.00
      recoverableAmountMinor: 129900,
      priority: PriorityLevel.MEDIUM,
      score: 70,
      reason: 'CARD_DECLINED: Card has expired',
      evidence: { gateway: 'razorpay', error_code: 'EXPIRED_CARD' }
    }
  })

  console.log('[Setup] Test tenants, customers, and opportunities seeded successfully.\n')

  try {
    // 1. High-Entropy Token Generation Assertion
    console.log('Test 1: High-entropy cryptographic token generation')
    const { rawToken, recoveryUrl, tokenRecord } = await createRecoveryToken({
      tenantId: tenantA.id,
      opportunityId: opportunityA.id,
      expiresInSeconds: 3600
    })
    assert.strictEqual(typeof rawToken, 'string')
    assert.strictEqual(rawToken.length, 64, 'Raw token must be 64 hex chars (32 bytes entropy)')
    assert.match(rawToken, /^[a-f0-9]{64}$/, 'Raw token must be valid lowercase hex')
    assert.ok(recoveryUrl.includes(`/recover/${rawToken}`), 'Recovery URL must include raw token')
    console.log('✓ Passed: Token has 256 bits of entropy (64 hex characters)')

    // 2. Hash-Only Database Storage Assertion
    console.log('\nTest 2: Database stores only SHA-256 hash, never raw token')
    const expectedHash = hashToken(rawToken)
    assert.strictEqual(tokenRecord.tokenHash, expectedHash, 'DB tokenHash must equal sha256(rawToken)')
    const dbRecord = await prisma.recoveryToken.findUnique({ where: { tokenHash: expectedHash } })
    assert.ok(dbRecord, 'DB record must be found via tokenHash')
    // Ensure raw token is not stored in plaintext anywhere in the record
    assert.strictEqual((dbRecord as any).rawToken, undefined, 'rawToken field must not exist on model')
    console.log('✓ Passed: Plaintext token is never persisted; only SHA-256 hash is in DB')

    // 3. Successful Verification of Valid Token
    console.log('\nTest 3: Verification of active, unexpired token')
    const verification = await verifyRecoveryToken(rawToken)
    assert.strictEqual(verification.valid, true)
    assert.strictEqual(verification.opportunity?.id, opportunityA.id)
    assert.strictEqual(verification.tenant?.id, tenantA.id)
    console.log('✓ Passed: Valid token successfully verified and resolved to opportunity & tenant')

    // 4. Public Recovery Details Sanitization
    console.log('\nTest 4: Public recovery details sanitization')
    const publicDetails = await getPublicRecoveryDetails(rawToken)
    assert.strictEqual(publicDetails.valid, true)
    assert.strictEqual(publicDetails.merchantName, 'Acme SaaS Corp')
    assert.strictEqual(publicDetails.customerName, 'Alex Johnson')
    assert.strictEqual(publicDetails.maskedEmail, 'c***x@e***.com')
    assert.strictEqual(publicDetails.amountMinor, 499900)
    assert.strictEqual(publicDetails.amountFormatted, '₹4,999.00')
    assert.strictEqual((publicDetails as any).tenantId, undefined, 'tenantId must NOT be exposed')
    assert.strictEqual((publicDetails as any).tokenHash, undefined, 'tokenHash must NOT be exposed')
    assert.ok(publicDetails.reason?.includes('insufficient funds'), 'Reason should be human-friendly')
    console.log('✓ Passed: Public details are strictly sanitized and internal IDs are hidden')

    // 5. PII Masking Helper
    console.log('\nTest 5: Email masking verification')
    assert.strictEqual(maskEmail('alex.smith@example.com'), 'a***h@e***.com')
    assert.strictEqual(maskEmail('support@company.org'), 's***t@c***.org')
    assert.strictEqual(maskEmail('a@b.com'), 'a***@b***.com')
    console.log('✓ Passed: Customer emails are safely masked to prevent PII exposure')

    // 6. Friendly Reason Sanitizer
    console.log('\nTest 6: Error reason translation')
    assert.ok(sanitizeCustomerReason('GATEWAY_ERROR: Insufficient balance').includes('insufficient funds'))
    assert.ok(sanitizeCustomerReason('Card expired on 09/26').includes('expired'))
    assert.ok(sanitizeCustomerReason('CVV check failed').includes('verification code'))
    assert.ok(sanitizeCustomerReason('Bank rejected transaction').includes('declined'))
    console.log('✓ Passed: Technical errors are converted to respectful customer explanations')

    // 7. Currency Formatter
    console.log('\nTest 7: Minor unit currency formatting')
    assert.strictEqual(formatCurrencyAmount(499900, 'INR'), '₹4,999.00')
    assert.strictEqual(formatCurrencyAmount(10000, 'INR'), '₹100.00')
    assert.strictEqual(formatCurrencyAmount(50, 'INR'), '₹0.50')
    console.log('✓ Passed: Currency correctly formatted with Indian numbering and decimal precision')

    // 8. Expiration Enforcement
    console.log('\nTest 8: Expiration check')
    const { rawToken: expiredToken } = await createRecoveryToken({
      tenantId: tenantA.id,
      opportunityId: opportunityA.id,
      expiresInSeconds: -10 // expired 10 seconds ago
    })
    const expiredVerification = await verifyRecoveryToken(expiredToken)
    assert.strictEqual(expiredVerification.valid, false)
    assert.strictEqual(expiredVerification.error, 'EXPIRED')
    console.log('✓ Passed: Expired token is strictly rejected')

    // 9. Revocation Enforcement
    console.log('\nTest 9: Revocation check')
    const { rawToken: tokenToRevoke } = await createRecoveryToken({
      tenantId: tenantA.id,
      opportunityId: opportunityA.id,
      expiresInSeconds: 3600
    })
    const revoked = await revokeRecoveryToken(tokenToRevoke, 'Customer called support to cancel')
    assert.strictEqual(revoked, true)
    const revokedVerification = await verifyRecoveryToken(tokenToRevoke)
    assert.strictEqual(revokedVerification.valid, false)
    assert.strictEqual(revokedVerification.error, 'REVOKED')
    console.log('✓ Passed: Revoked token is strictly rejected')

    // 10. Malformed Token Rejection
    console.log('\nTest 10: Malformed token defense')
    const badTokens = ['', 'short', 'xyz-invalid-characters!!', 'a'.repeat(63), 'g'.repeat(64)]
    for (const bt of badTokens) {
      const badVerif = await verifyRecoveryToken(bt)
      assert.strictEqual(badVerif.valid, false)
      assert.strictEqual(badVerif.error, 'INVALID_FORMAT')
    }
    console.log('✓ Passed: Non-hex or invalid-length tokens fail fast without database hit')

    // 11. Non-Existent Token
    console.log('\nTest 11: Non-existent token check')
    const nonExistent = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    const notFoundVerif = await verifyRecoveryToken(nonExistent)
    assert.strictEqual(notFoundVerif.valid, false)
    assert.strictEqual(notFoundVerif.error, 'INVALID_TOKEN')
    console.log('✓ Passed: Valid-format token absent from DB returns INVALID_TOKEN')

    // 12. Cross-Tenant Token Isolation
    console.log('\nTest 12: Cross-tenant isolation')
    const { rawToken: tokenTenantB } = await createRecoveryToken({
      tenantId: tenantB.id,
      opportunityId: opportunityB.id,
      expiresInSeconds: 3600
    })
    const verifA = await verifyRecoveryToken(rawToken)
    const verifB = await verifyRecoveryToken(tokenTenantB)
    assert.strictEqual(verifA.tenant?.id, tenantA.id)
    assert.strictEqual(verifB.tenant?.id, tenantB.id)
    assert.notStrictEqual(verifA.tenant?.id, verifB.tenant?.id)
    console.log('✓ Passed: Tokens are strictly bound to their respective tenants and opportunities')

    // 13. Payment Resolution via Token
    console.log('\nTest 13: Transactional payment resolution')
    const resolution = await resolvePaymentWithToken(rawToken, {
      paymentMethod: 'UPI',
      actorIp: '203.0.113.10',
      userAgent: 'Mozilla/5.0 Safari'
    })
    assert.strictEqual(resolution.success, true)
    assert.strictEqual(resolution.statusCode, 200)
    assert.strictEqual(resolution.recoveredAmountMinor, 499900)
    assert.ok(resolution.receiptId?.startsWith('REC-'))
    console.log('✓ Passed: Payment resolution returned HTTP 200 and valid receipt ID')

    // 14. Single-Use Consumption Assertion
    console.log('\nTest 14: Single-use token consumption')
    const consumedVerification = await verifyRecoveryToken(rawToken)
    assert.strictEqual(consumedVerification.valid, false)
    assert.strictEqual(consumedVerification.error, 'ALREADY_CONSUMED')
    assert.strictEqual(consumedVerification.alreadyResolved, true)
    console.log('✓ Passed: Consumed token is marked and rejected for reuse')

    // 15. Replay Attack & Duplicate Resolution Protection
    console.log('\nTest 15: Replay protection and idempotency')
    const replayResolution = await resolvePaymentWithToken(rawToken)
    assert.strictEqual(replayResolution.success, true)
    assert.strictEqual(replayResolution.alreadyResolved, true)
    console.log('✓ Passed: Replay resolution is safely idempotent without duplicate charge')

    // 16. State Synchronization in Database
    console.log('\nTest 16: Database state synchronization')
    const freshOpp = await prisma.recoveryOpportunity.findUnique({ where: { id: opportunityA.id } })
    assert.strictEqual(freshOpp?.status, OpportunityStatus.RECOVERED)
    assert.ok(freshOpp?.resolvedAt !== null)

    const freshAction = await prisma.recoveryAction.findUnique({ where: { id: actionA.id } })
    assert.strictEqual(freshAction?.status, ActionStatus.EXECUTED)

    const outcomes = await prisma.recoveryOutcome.findMany({ where: { opportunityId: opportunityA.id } })
    assert.strictEqual(outcomes.length, 1)
    assert.strictEqual(outcomes[0].type, OutcomeType.SUCCESS)
    assert.strictEqual(outcomes[0].recoveredAmountMinor, 499900)
    console.log('✓ Passed: Opportunity is RECOVERED, Action is EXECUTED, and RecoveryOutcome is persisted')

    // 17. Immutable Audit Trail
    console.log('\nTest 17: Audit event trail verification')
    const auditLogs = await prisma.auditEvent.findMany({
      where: { opportunityId: opportunityA.id },
      orderBy: { timestamp: 'asc' }
    })
    const eventTypes = auditLogs.map(l => l.eventType)
    assert.ok(eventTypes.includes('RECOVERY_TOKEN_GENERATED'), 'Must have RECOVERY_TOKEN_GENERATED audit log')
    assert.ok(eventTypes.includes('CUSTOMER_PORTAL_PAYMENT_RESOLVED'), 'Must have CUSTOMER_PORTAL_PAYMENT_RESOLVED audit log')
    console.log('✓ Passed: Audit trail recorded all token generation and resolution events')

    // 18. Public API Route: GET /api/recover/[token]
    console.log('\nTest 18: Public API GET endpoint contract')
    const reqGet = createMockRequest(`/api/recover/${tokenTenantB}`, 'GET')
    const resGet = await getRecoverRoute(reqGet, { params: Promise.resolve({ token: tokenTenantB }) })
    assert.strictEqual(resGet.status, 200)
    const jsonGet = await resGet.json()
    assert.strictEqual(jsonGet.success, true)
    assert.strictEqual(jsonGet.merchantName, 'Beta Cloud Ltd')
    assert.strictEqual(jsonGet.amountFormatted, '₹1,299.00')
    assert.strictEqual(resGet.headers.get('cache-control')?.includes('no-store'), true)
    console.log('✓ Passed: GET /api/recover/[token] returns 200, valid metadata, and no-store headers')

    // 19. Public API Route: POST /api/recover/[token]
    console.log('\nTest 19: Public API POST endpoint contract')
    const reqPost = createMockRequest(`/api/recover/${tokenTenantB}`, 'POST', { paymentMethod: 'CUSTOMER_PORTAL' })
    const resPost = await postRecoverRoute(reqPost, { params: Promise.resolve({ token: tokenTenantB }) })
    assert.strictEqual(resPost.status, 200)
    const jsonPost = await resPost.json()
    assert.strictEqual(jsonPost.success, true)
    assert.ok(jsonPost.receiptId)
    assert.strictEqual(jsonPost.recoveredAmountMinor, 129900)
    console.log('✓ Passed: POST /api/recover/[token] successfully resolves payment via HTTP route')

    // 20. Public API Route: Invalid and Expired Token HTTP Status Codes
    console.log('\nTest 20: HTTP error status codes for invalid and expired tokens')
    const reqInvalid = createMockRequest('/api/recover/nonexistent-token', 'GET')
    const resInvalid = await getRecoverRoute(reqInvalid, { params: Promise.resolve({ token: 'nonexistent-token' }) })
    assert.strictEqual(resInvalid.status, 404)

    const reqExpired = createMockRequest(`/api/recover/${expiredToken}`, 'GET')
    const resExpired = await getRecoverRoute(reqExpired, { params: Promise.resolve({ token: expiredToken }) })
    assert.strictEqual(resExpired.status, 410)
    console.log('✓ Passed: Invalid token returns 404, expired token returns 410')

    console.log('\n============================================================')
    console.log('ALL 20 CUSTOMER RECOVERY & PAYMENT RESOLUTION TESTS PASSED!')
    console.log('============================================================\n')

  } finally {
    // Cleanup test records
    console.log('[Cleanup] Cleaning up test fixtures...')
    await prisma.recoveryToken.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } })
    await prisma.recoveryOutcome.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } })
    await prisma.recoveryAction.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } })
    await prisma.recoveryOpportunity.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } })
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } })
    await prisma.auditEvent.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } })
    console.log('[Cleanup] Test fixtures cleaned up successfully.\n')
  }
}

runCustomerRecoveryTests().catch(err => {
  console.error('Test failed with error:', err)
  process.exit(1)
})