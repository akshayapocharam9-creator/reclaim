import prisma from '../prisma'
import {
  executeRecoveryAction,
  dismissOpportunity,
  markOpportunityRecovered,
  markOpportunityFailed,
  getOpportunityActionState
} from './workflow'
import { ActionStatus, ActionType, OpportunityStatus, OpportunityType, PriorityLevel } from '@prisma/client'

async function runTests() {
  console.log('=== PRODUCTION-LIKE RECOVERY ACTION WORKFLOW TEST ===')

  const TENANT_ID = process.env.RAZORPAY_TENANT_ID || 'cmtkeayky00005qkzmnagbcbb'
  const FOREIGN_TENANT_ID = 'foreign-tenant-xyz-999'

  // Step 0: Ensure we have clean test opportunities for deterministic verification
  console.log('\n[1] Setting up dedicated test opportunities...')

  // Create Opportunity 1 for Action -> Recover cycle
  const opp1 = await prisma.recoveryOpportunity.create({
    data: {
      tenantId: TENANT_ID,
      type: OpportunityType.PAYMENT_FAILURE,
      status: OpportunityStatus.DETECTED,
      amountAtRiskMinor: 1500000,
      recoverableAmountMinor: 1350000,
      priority: PriorityLevel.HIGH,
      score: 85,
      confidenceScore: 0.9,
      reason: 'Workflow test opportunity: Payment failure',
      evidence: { test: true }
    }
  })
  console.log(`Created test opportunity 1: ${opp1.id} (Status: ${opp1.status})`)

  // Create Opportunity 2 for Action -> Fail cycle
  const opp2 = await prisma.recoveryOpportunity.create({
    data: {
      tenantId: TENANT_ID,
      type: OpportunityType.REPEATED_PAYMENT_FAILURE,
      status: OpportunityStatus.DETECTED,
      amountAtRiskMinor: 2500000,
      recoverableAmountMinor: 1750000,
      priority: PriorityLevel.CRITICAL,
      score: 95,
      confidenceScore: 0.95,
      reason: 'Workflow test opportunity: Repeated payment failure',
      evidence: { test: true }
    }
  })
  console.log(`Created test opportunity 2: ${opp2.id} (Status: ${opp2.status})`)

  // Create Opportunity 3 for Dismiss cycle
  const opp3 = await prisma.recoveryOpportunity.create({
    data: {
      tenantId: TENANT_ID,
      type: OpportunityType.CHECKOUT_ABANDONMENT,
      status: OpportunityStatus.DETECTED,
      amountAtRiskMinor: 500000,
      recoverableAmountMinor: 125000,
      priority: PriorityLevel.MEDIUM,
      score: 60,
      confidenceScore: 0.65,
      reason: 'Workflow test opportunity: Checkout abandonment',
      evidence: { test: true }
    }
  })
  console.log(`Created test opportunity 3: ${opp3.id} (Status: ${opp3.status})`)

  // --- TEST 1: Cross-Tenant Protection on Action Initiation ---
  console.log('\n[2] Testing Cross-Tenant Protection...')
  const crossTenantResult = await executeRecoveryAction({
    tenantId: FOREIGN_TENANT_ID,
    opportunityId: opp1.id
  })
  console.assert(!crossTenantResult.success, 'Cross-tenant action should be rejected')
  console.assert(crossTenantResult.statusCode === 404, 'Cross-tenant should return 404')
  console.log('Cross-tenant isolation verified: Rejected successfully.')

  // --- TEST 2: Execute Recovery Action (DETECTED -> IN_PROGRESS) ---
  console.log('\n[3] Testing Action Initiation (DETECTED -> IN_PROGRESS)...')
  const actionResult = await executeRecoveryAction({
    tenantId: TENANT_ID,
    opportunityId: opp1.id,
    actionType: ActionType.RETRY_PAYMENT,
    notes: 'Automated retry scheduled internally'
  })

  console.assert(actionResult.success === true, 'Action initiation must succeed')
  console.assert(actionResult.opportunity.status === OpportunityStatus.IN_PROGRESS, 'Opportunity status must transition to IN_PROGRESS')
  console.assert(actionResult.action.type === ActionType.RETRY_PAYMENT, 'Action type must match')
  console.assert(actionResult.action.status === ActionStatus.APPROVED, 'Action status must be APPROVED')
  console.assert(actionResult.action.expectedRecoveryAmountMinor === 1350000, 'Expected recovery must be 1350000 minor units')
  console.assert(actionResult.action.executedAt !== null, 'Timestamp must be recorded')
  console.log(`Action persisted: ID=${actionResult.action.id}, Opportunity Status=${actionResult.opportunity.status}`)

  // --- TEST 3: Duplicate Action Idempotency ---
  console.log('\n[4] Testing Duplicate Action Idempotency...')
  const duplicateResult = await executeRecoveryAction({
    tenantId: TENANT_ID,
    opportunityId: opp1.id
  })
  console.assert(duplicateResult.success === true, 'Repeated call must succeed')
  console.assert(duplicateResult.isIdempotent === true, 'Must flag as idempotent')
  console.assert(duplicateResult.action.id === actionResult.action.id, 'Must return the same existing action')

  const actionsCount = await prisma.recoveryAction.count({ where: { opportunityId: opp1.id } })
  console.assert(actionsCount === 1, `Must NOT create duplicate actions in DB (Count is ${actionsCount})`)
  console.log('Duplicate action idempotency verified: No duplicate records created.')

  // --- TEST 4: Invalid Transition Check (Cannot mark RECOVERED directly from DETECTED) ---
  console.log('\n[5] Testing Invalid State Transitions...')
  const invalidRecover = await markOpportunityRecovered({
    tenantId: TENANT_ID,
    opportunityId: opp3.id // opp3 is still DETECTED
  })
  console.assert(!invalidRecover.success, 'Cannot mark RECOVERED from DETECTED')
  console.assert(invalidRecover.statusCode === 409, 'Should return 409 Conflict')
  console.log('Invalid transition directly from DETECTED -> RECOVERED rejected.')

  // --- TEST 5: Mark Recovered (IN_PROGRESS -> RECOVERED) ---
  console.log('\n[6] Testing Mark Recovered (IN_PROGRESS -> RECOVERED)...')
  const recoverResult = await markOpportunityRecovered({
    tenantId: TENANT_ID,
    opportunityId: opp1.id,
    notes: 'Payment settled via customer portal'
  })
  console.assert(recoverResult.success === true, 'Mark recovered must succeed')
  console.assert(recoverResult.opportunity.status === OpportunityStatus.RECOVERED, 'Opportunity must be RECOVERED')

  // Verify RecoveryOutcome record was created in DB
  const outcome = await prisma.recoveryOutcome.findFirst({ where: { opportunityId: opp1.id } })
  console.assert(outcome !== null, 'RecoveryOutcome record must be persisted')
  console.assert(outcome?.recoveredAmountMinor === 1350000, 'Outcome amount must match recoverable amount')
  console.log(`Recovery verified: Outcome ID=${outcome?.id}, AmountMinor=${outcome?.recoveredAmountMinor}`)

  // --- TEST 6: Invalid Transition Check (Cannot action an already RECOVERED opportunity) ---
  console.log('\n[7] Testing Action on Terminated Opportunity...')
  const actionOnRecovered = await executeRecoveryAction({
    tenantId: TENANT_ID,
    opportunityId: opp1.id
  })
  console.assert(!actionOnRecovered.success, 'Cannot action a RECOVERED opportunity')
  console.assert(actionOnRecovered.statusCode === 409, 'Must return 409')
  console.log('Transition from RECOVERED -> ACTION rejected successfully.')

  // --- TEST 7: Action -> Mark Failed Cycle on opp2 ---
  console.log('\n[8] Testing Action -> Mark Failed Cycle (IN_PROGRESS -> FAILED)...')
  await executeRecoveryAction({
    tenantId: TENANT_ID,
    opportunityId: opp2.id,
    actionType: ActionType.CONTACT_CUSTOMER
  })

  const failResult = await markOpportunityFailed({
    tenantId: TENANT_ID,
    opportunityId: opp2.id,
    failureReason: 'Customer declined payment retry'
  })
  console.assert(failResult.success === true, 'Mark failed must succeed')
  console.assert(failResult.opportunity.status === OpportunityStatus.FAILED, 'Opportunity must be FAILED')
  console.assert(failResult.action.status === ActionStatus.FAILED, 'Action status must be FAILED')
  console.assert(failResult.action.failureReason === 'Customer declined payment retry', 'Failure reason must be persisted')
  console.log('Failure lifecycle verified.')

  // --- TEST 8: Dismiss Opportunity on opp3 (DETECTED -> DISMISSED) ---
  console.log('\n[9] Testing Dismiss Cycle (DETECTED -> DISMISSED)...')
  const dismissResult = await dismissOpportunity({
    tenantId: TENANT_ID,
    opportunityId: opp3.id,
    reason: 'False positive detected by operator'
  })
  console.assert(dismissResult.success === true, 'Dismiss must succeed')
  console.assert(dismissResult.opportunity.status === OpportunityStatus.DISMISSED, 'Status must be DISMISSED')

  // Re-dismiss idempotency
  const reDismiss = await dismissOpportunity({
    tenantId: TENANT_ID,
    opportunityId: opp3.id
  })
  console.assert(reDismiss.isIdempotent === true, 'Re-dismiss must be idempotent')
  console.log('Dismiss cycle verified: Idempotent and correctly persisted.')

  // --- TEST 9: Query Full Action State via getOpportunityActionState ---
  console.log('\n[10] Verifying Action State Retrieval...')
  const state = await getOpportunityActionState({
    tenantId: TENANT_ID,
    opportunityId: opp1.id
  })
  console.assert(state !== null, 'State must exist')
  console.assert(state?.opportunityStatus === OpportunityStatus.RECOVERED, 'Status must reflect RECOVERED')
  console.assert(state?.actions.length === 1, 'Must have 1 action recorded')
  console.assert(state?.outcomes.length === 1, 'Must have 1 outcome recorded')
  console.log('Action state and audit history retrieval verified.')

  // Clean up test records
  console.log('\n[11] Cleaning up test records...')
  await prisma.recoveryOutcome.deleteMany({ where: { opportunityId: { in: [opp1.id, opp2.id, opp3.id] } } })
  await prisma.recoveryAction.deleteMany({ where: { opportunityId: { in: [opp1.id, opp2.id, opp3.id] } } })
  await prisma.recoveryOpportunity.deleteMany({ where: { id: { in: [opp1.id, opp2.id, opp3.id] } } })
  console.log('Test records safely cleaned up.')

  console.log('\n=== ALL WORKFLOW TESTS PASSED ===')
}

runTests()
  .catch((err) => {
    console.error('Test execution failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
