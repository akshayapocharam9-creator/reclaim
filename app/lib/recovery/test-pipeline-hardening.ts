import prisma from '../prisma'
import { OpportunityStatus, OutcomeType, ActionStatus, ActionType } from '@prisma/client'
import { createRecoveryToken } from './token-service'
import { queueExecution } from '../execution/service'
import { reconcileRecoveryOutcome } from '../execution/outcome-reconciler'
import { stopActiveCadenceForOpportunity, scheduleDunningCadence } from './dunning-cadence-service'
import { getOpportunityActionState } from '../recovery-agent/workflow'

async function runHardeningTests() {
  console.log('=== RUNNING RECOVERY PIPELINE HARDENING TEST SUITE ===')

  const tenant = await prisma.tenant.findFirst()
  if (!tenant) throw new Error('No tenant found')

  const createdOppIds: string[] = []

  try {
    // -------------------------------------------------------------
    // Test 1: createRecoveryToken rejects terminal opportunities
    // -------------------------------------------------------------
    console.log('\nTest 1: createRecoveryToken rejects terminal opportunities')
    const oppRecovered = await prisma.recoveryOpportunity.create({
      data: {
        tenantId: tenant.id,
        type: 'PAYMENT_FAILURE',
        status: OpportunityStatus.RECOVERED,
        amountAtRiskMinor: 5000,
        recoverableAmountMinor: 5000,
        priority: 'HIGH',
        score: 95,
        reason: 'Hardening test - terminal token minting guard',
        evidence: {}
      }
    })
    createdOppIds.push(oppRecovered.id)

    let tokenErrorCaught = false
    try {
      await createRecoveryToken({
        tenantId: tenant.id,
        opportunityId: oppRecovered.id
      })
    } catch (err: unknown) {
      tokenErrorCaught = true
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('terminal state')) {
        throw new Error(`Unexpected error message: ${msg}`)
      }
    }

    if (!tokenErrorCaught) {
      throw new Error('Expected createRecoveryToken to throw for RECOVERED opportunity, but it succeeded')
    }
    console.log('✓ Passed: Token minting rejected for RECOVERED opportunity')

    // -------------------------------------------------------------
    // Test 2: queueExecution rejects terminal opportunities
    // -------------------------------------------------------------
    console.log('\nTest 2: queueExecution rejects terminal opportunities')
    const action = await prisma.recoveryAction.create({
      data: {
        tenantId: tenant.id,
        opportunityId: oppRecovered.id,
        type: ActionType.RETRY_PAYMENT,
        status: ActionStatus.APPROVED,
        channel: 'AUTOMATED',
        expectedRecoveryAmountMinor: 5000
      }
    })

    const queueRes = await queueExecution({
      tenantId: tenant.id,
      opportunityId: oppRecovered.id,
      actionId: action.id
    })

    if (queueRes.success || queueRes.statusCode !== 409) {
      throw new Error(`Expected queueExecution to return 409 for RECOVERED opportunity, got ${queueRes.statusCode}`)
    }
    console.log('✓ Passed: queueExecution correctly rejected with 409 for terminal opportunity')

    // -------------------------------------------------------------
    // Test 3: queueExecution rejects already EXECUTED actions
    // -------------------------------------------------------------
    console.log('\nTest 3: queueExecution rejects already EXECUTED actions')
    const oppActive = await prisma.recoveryOpportunity.create({
      data: {
        tenantId: tenant.id,
        type: 'PAYMENT_FAILURE',
        status: OpportunityStatus.IN_PROGRESS,
        amountAtRiskMinor: 4000,
        recoverableAmountMinor: 4000,
        priority: 'MEDIUM',
        score: 80,
        reason: 'Hardening test - active opportunity',
        evidence: {}
      }
    })
    createdOppIds.push(oppActive.id)

    const executedAction = await prisma.recoveryAction.create({
      data: {
        tenantId: tenant.id,
        opportunityId: oppActive.id,
        type: ActionType.RETRY_PAYMENT,
        status: ActionStatus.EXECUTED,
        channel: 'AUTOMATED',
        expectedRecoveryAmountMinor: 4000
      }
    })

    const queueExecutedRes = await queueExecution({
      tenantId: tenant.id,
      opportunityId: oppActive.id,
      actionId: executedAction.id
    })

    if (queueExecutedRes.success || queueExecutedRes.statusCode !== 409) {
      throw new Error(`Expected queueExecution to return 409 for EXECUTED action, got ${queueExecutedRes.statusCode}`)
    }
    console.log('✓ Passed: queueExecution correctly rejected with 409 for EXECUTED action')

    // -------------------------------------------------------------
    // Test 4: reconcileRecoveryOutcome idempotency on RECOVERED opportunity
    // -------------------------------------------------------------
    console.log('\nTest 4: reconcileRecoveryOutcome idempotency on RECOVERED opportunity')
    const oppReconcile = await prisma.recoveryOpportunity.create({
      data: {
        tenantId: tenant.id,
        type: 'PAYMENT_FAILURE',
        status: OpportunityStatus.IN_PROGRESS,
        amountAtRiskMinor: 6000,
        recoverableAmountMinor: 6000,
        priority: 'HIGH',
        score: 88,
        reason: 'Hardening test - reconciliation idempotency',
        evidence: {}
      }
    })
    createdOppIds.push(oppReconcile.id)

    // First reconciliation
    const firstReconcile = await reconcileRecoveryOutcome({
      tenantId: tenant.id,
      opportunityId: oppReconcile.id,
      outcomeType: OutcomeType.SUCCESS,
      recoveredAmountMinor: 6000,
      reason: 'First reconciliation'
    })

    if (!firstReconcile.success || firstReconcile.isIdempotent) {
      throw new Error('First reconciliation should succeed without isIdempotent flag')
    }

    // Second duplicate reconciliation with same outcomeType
    const secondReconcile = await reconcileRecoveryOutcome({
      tenantId: tenant.id,
      opportunityId: oppReconcile.id,
      outcomeType: OutcomeType.SUCCESS,
      recoveredAmountMinor: 6000,
      reason: 'Second duplicate reconciliation'
    })

    if (!secondReconcile.success || !secondReconcile.isIdempotent || secondReconcile.statusCode !== 200) {
      throw new Error(`Expected second reconciliation to be idempotent (200), got status ${secondReconcile.statusCode}`)
    }

    // Check that only 1 outcome exists for this opportunity
    const outcomeCount = await prisma.recoveryOutcome.count({
      where: { opportunityId: oppReconcile.id }
    })
    if (outcomeCount !== 1) {
      throw new Error(`Expected exactly 1 RecoveryOutcome record, found ${outcomeCount}`)
    }
    console.log('✓ Passed: Repeated reconciliation returns 200 idempotent without creating duplicate outcome')

    // -------------------------------------------------------------
    // Test 5: stopActiveCadenceForOpportunity logs an immutable audit event
    // -------------------------------------------------------------
    console.log('\nTest 5: stopActiveCadenceForOpportunity logs an audit event')
    const oppDunning = await prisma.recoveryOpportunity.create({
      data: {
        tenantId: tenant.id,
        type: 'PAYMENT_FAILURE',
        status: OpportunityStatus.IN_PROGRESS,
        amountAtRiskMinor: 3500,
        recoverableAmountMinor: 3500,
        priority: 'HIGH',
        score: 85,
        reason: 'Hardening test - dunning audit stop',
        evidence: {}
      }
    })
    createdOppIds.push(oppDunning.id)

    const schedRes = await scheduleDunningCadence(tenant.id, oppDunning.id)
    if (!schedRes.success) throw new Error('Failed to schedule cadence')

    await stopActiveCadenceForOpportunity({
      tenantId: tenant.id,
      opportunityId: oppDunning.id,
      terminalStatus: OpportunityStatus.RECOVERED
    })

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        tenantId: tenant.id,
        opportunityId: oppDunning.id,
        eventType: 'DUNNING_CADENCE_STOPPED'
      }
    })

    if (!auditEvent) {
      throw new Error('Expected DUNNING_CADENCE_STOPPED audit event to be logged')
    }
    console.log('✓ Passed: DUNNING_CADENCE_STOPPED audit event recorded successfully')

    // -------------------------------------------------------------
    // Test 6: getOpportunityActionState hasActivePortal is false for terminal opportunity
    // -------------------------------------------------------------
    console.log('\nTest 6: getOpportunityActionState hasActivePortal invariant for terminal opportunity')
    const state = await getOpportunityActionState({
      tenantId: tenant.id,
      opportunityId: oppRecovered.id
    })

    if (state?.hasActivePortal !== false) {
      throw new Error(`Expected hasActivePortal to be false for RECOVERED opportunity, got ${state?.hasActivePortal}`)
    }
    console.log('✓ Passed: hasActivePortal is false for terminal opportunity')

    console.log('\n=============================================================')
    console.log('ALL PIPELINE HARDENING INVARIANTS VERIFIED SUCCESSFULLY!')
    console.log('=============================================================')

  } finally {
    // Clean up created test data
    console.log('\n[Cleanup] Cleaning up test fixtures...')
    if (createdOppIds.length > 0) {
      await prisma.dunningCadence.deleteMany({
        where: { opportunityId: { in: createdOppIds } }
      })
      await prisma.recoveryOutcome.deleteMany({
        where: { opportunityId: { in: createdOppIds } }
      })
      await prisma.recoveryExecution.deleteMany({
        where: { opportunityId: { in: createdOppIds } }
      })
      await prisma.recoveryAction.deleteMany({
        where: { opportunityId: { in: createdOppIds } }
      })
      await prisma.recoveryToken.deleteMany({
        where: { opportunityId: { in: createdOppIds } }
      })
      await prisma.auditEvent.deleteMany({
        where: { opportunityId: { in: createdOppIds } }
      })
      await prisma.recoveryOpportunity.deleteMany({
        where: { id: { in: createdOppIds } }
      })
    }
    console.log('[Cleanup] Done.')
  }
}

runHardeningTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Test failed:', err)
    process.exit(1)
  })
