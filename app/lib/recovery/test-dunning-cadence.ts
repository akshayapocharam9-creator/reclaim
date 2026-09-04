import prisma from '../prisma'
import { CadenceStatus, OpportunityStatus } from '@prisma/client'
import { scheduleDunningCadence, advanceDunningCadence, processDueCadences } from './dunning-cadence-service'
import { processExecution } from '../execution/service'

async function runTests() {
  console.log('--- RUNNING DUNNING CADENCE TESTS ---')

  const tenant = await prisma.tenant.findFirst()
  if (!tenant) throw new Error('No tenant found')

  // 1. Create a dummy opportunity
  const opp = await prisma.recoveryOpportunity.create({
    data: {
      tenantId: tenant.id,
      type: 'PAYMENT_FAILURE',
      status: 'DETECTED',
      amountAtRiskMinor: 1000,
      recoverableAmountMinor: 1000,
      priority: 'HIGH',
      score: 90,
      reason: 'Test cadence',
      evidence: {}
    }
  })

  // 2. Schedule Cadence
  const scheduleRes = await scheduleDunningCadence(tenant.id, opp.id)
  if (!scheduleRes.success || !scheduleRes.cadenceId) throw new Error('Failed to schedule cadence')
  console.log('✅ Scheduled Dunning Cadence (Step 1)')

  // 3. Advance Cadence (Day 1)
  const advance1 = await advanceDunningCadence(scheduleRes.cadenceId)
  if (!advance1.success || advance1.newStatus !== CadenceStatus.SCHEDULED) throw new Error('Failed to advance step 1')
  
  const cad1 = await prisma.dunningCadence.findUnique({ where: { id: scheduleRes.cadenceId } })
  if (cad1?.currentStep !== 2) throw new Error(`Expected step 2, got ${cad1?.currentStep}`)
  console.log('✅ Advanced to Step 2 (Day 3)')

  // Verify action/execution
  const actions = await prisma.recoveryAction.findMany({ where: { opportunityId: opp.id } })
  if (actions.length !== 1) throw new Error('Expected 1 action created')

  // 4. Force scheduledAt to past, and process due cadences
  await prisma.dunningCadence.update({
    where: { id: cad1.id },
    data: { scheduledAt: new Date(Date.now() - 10000) } // 10 seconds ago
  })

  const processRes = await processDueCadences(tenant.id)
  if (processRes.processed !== 1) throw new Error(`Expected 1 cadence processed, got ${processRes.processed}`)
  console.log('✅ Background worker picked up and advanced to Step 3 (Day 7)')

  // 5. Check cadence completed after advancing Step 3
  // Process due again by faking time
  const cad3 = await prisma.dunningCadence.findUnique({ where: { id: scheduleRes.cadenceId } })
  if (!cad3 || cad3.currentStep !== 3) throw new Error('Expected step 3')

  await prisma.dunningCadence.update({
    where: { id: cad3.id },
    data: { scheduledAt: new Date(Date.now() - 10000) }
  })
  const processRes3 = await processDueCadences(tenant.id)
  if (processRes3.processed !== 1) throw new Error('Expected 1 cadence processed')

  const finalCad = await prisma.dunningCadence.findUnique({ where: { id: scheduleRes.cadenceId } })
  if (finalCad?.status !== CadenceStatus.COMPLETED) throw new Error('Expected Cadence to be COMPLETED')
  console.log('✅ Cadence gracefully COMPLETED after Step 3')

  // 6. Test premature terminal opportunity resolution
  const opp2 = await prisma.recoveryOpportunity.create({
    data: {
      tenantId: tenant.id,
      type: 'PAYMENT_FAILURE',
      status: 'RECOVERED', // Already recovered
      amountAtRiskMinor: 1000,
      recoverableAmountMinor: 1000,
      priority: 'HIGH',
      score: 90,
      reason: 'Test terminal',
      evidence: {}
    }
  })

  const sch2 = await scheduleDunningCadence(tenant.id, opp2.id)
  if (sch2.success) throw new Error('Should not schedule for RECOVERED opp')
  console.log('✅ Properly blocked scheduling on already-recovered opportunity')

  // 7. Verify a queued execution aborts if opportunity is recovered in the meantime
  const opp3 = await prisma.recoveryOpportunity.create({
    data: {
      tenantId: tenant.id,
      type: 'PAYMENT_FAILURE',
      status: 'DETECTED',
      amountAtRiskMinor: 1000,
      recoverableAmountMinor: 1000,
      priority: 'HIGH',
      score: 90,
      reason: 'Test abort on recovered',
      evidence: {}
    }
  })

  // Schedule and advance to get a queued execution
  const sch3 = await scheduleDunningCadence(tenant.id, opp3.id)
  if (!sch3.success || !sch3.cadenceId) throw new Error('Failed to schedule cadence 3')
  const adv3 = await advanceDunningCadence(sch3.cadenceId)
  if (!adv3.success || !adv3.executionId) throw new Error('Failed to advance cadence 3')

  // Now mutate the opportunity to RECOVERED externally
  await prisma.recoveryOpportunity.update({
    where: { id: opp3.id },
    data: { status: 'RECOVERED' }
  })

  // Attempt to process the queued execution
  const execResult = await processExecution(adv3.executionId, tenant.id)
  
  if (execResult.success || execResult.statusCode !== 409) {
    throw new Error('processExecution should have aborted with 409 for a RECOVERED opportunity')
  }

  const abortedExec = await prisma.recoveryExecution.findUnique({ where: { id: adv3.executionId } })
  if (abortedExec?.status !== 'CANCELLED') {
    throw new Error('Execution should be marked CANCELLED')
  }
  
  console.log('✅ Execution aborted safely when opportunity was already RECOVERED')

  // 8. Test immediate cadence completion via markOpportunityRecovered
  const { markOpportunityRecovered, dismissOpportunity } = await import('../recovery-agent/workflow')
  const { reconcileRecoveryOutcome } = await import('../execution/outcome-reconciler')

  const opp4 = await prisma.recoveryOpportunity.create({
    data: {
      tenantId: tenant.id,
      type: 'PAYMENT_FAILURE',
      status: 'IN_PROGRESS',
      amountAtRiskMinor: 2000,
      recoverableAmountMinor: 2000,
      priority: 'HIGH',
      score: 85,
      reason: 'Test immediate stop on markOpportunityRecovered',
      evidence: {}
    }
  })

  const sch4 = await scheduleDunningCadence(tenant.id, opp4.id)
  if (!sch4.success || !sch4.cadenceId) throw new Error('Failed to schedule cadence 4')

  const cad4Before = await prisma.dunningCadence.findUnique({ where: { id: sch4.cadenceId } })
  if (cad4Before?.status !== CadenceStatus.SCHEDULED) throw new Error('Expected cadence 4 to be SCHEDULED initially')

  // Mark recovered
  const recoverRes = await markOpportunityRecovered({
    tenantId: tenant.id,
    opportunityId: opp4.id
  })
  if (!recoverRes.success) throw new Error('Failed to mark opportunity recovered')

  const cad4After = await prisma.dunningCadence.findUnique({ where: { id: sch4.cadenceId } })
  if (cad4After?.status !== CadenceStatus.COMPLETED) {
    throw new Error(`Expected cadence 4 to be COMPLETED after recovery, got ${cad4After?.status}`)
  }
  if (!cad4After.completedAt) throw new Error('Expected completedAt to be populated on cadence 4')
  console.log('✅ markOpportunityRecovered immediately completes active dunning cadence with completedAt')

  // 9. Test immediate cadence completion via reconcileRecoveryOutcome
  const opp5 = await prisma.recoveryOpportunity.create({
    data: {
      tenantId: tenant.id,
      type: 'PAYMENT_FAILURE',
      status: 'IN_PROGRESS',
      amountAtRiskMinor: 3000,
      recoverableAmountMinor: 3000,
      priority: 'HIGH',
      score: 80,
      reason: 'Test immediate stop on reconcileRecoveryOutcome',
      evidence: {}
    }
  })

  const sch5 = await scheduleDunningCadence(tenant.id, opp5.id)
  if (!sch5.success || !sch5.cadenceId) throw new Error('Failed to schedule cadence 5')

  const reconcileRes = await reconcileRecoveryOutcome({
    tenantId: tenant.id,
    opportunityId: opp5.id,
    outcomeType: 'SUCCESS',
    recoveredAmountMinor: 3000,
    reason: 'Verified gateway capture'
  })
  if (!reconcileRes.success) throw new Error('Failed to reconcile outcome')

  const cad5After = await prisma.dunningCadence.findUnique({ where: { id: sch5.cadenceId } })
  if (cad5After?.status !== CadenceStatus.COMPLETED) {
    throw new Error(`Expected cadence 5 to be COMPLETED after outcome reconciliation, got ${cad5After?.status}`)
  }
  if (!cad5After.completedAt) throw new Error('Expected completedAt to be populated on cadence 5')
  console.log('✅ reconcileRecoveryOutcome immediately completes active dunning cadence')

  // 10. Test immediate cadence completion on DISMISSED
  const opp6 = await prisma.recoveryOpportunity.create({
    data: {
      tenantId: tenant.id,
      type: 'PAYMENT_FAILURE',
      status: 'DETECTED',
      amountAtRiskMinor: 1500,
      recoverableAmountMinor: 1500,
      priority: 'MEDIUM',
      score: 70,
      reason: 'Test immediate stop on dismiss',
      evidence: {}
    }
  })

  const sch6 = await scheduleDunningCadence(tenant.id, opp6.id)
  if (!sch6.success || !sch6.cadenceId) throw new Error('Failed to schedule cadence 6')

  await dismissOpportunity({
    tenantId: tenant.id,
    opportunityId: opp6.id,
    reason: 'Dismissed by test'
  })

  const cad6After = await prisma.dunningCadence.findUnique({ where: { id: sch6.cadenceId } })
  if (cad6After?.status !== CadenceStatus.COMPLETED) {
    throw new Error(`Expected cadence 6 to be COMPLETED after dismiss, got ${cad6After?.status}`)
  }
  console.log('✅ dismissOpportunity immediately completes active dunning cadence')

  // Cleanup test records created in this run
  await prisma.dunningCadence.deleteMany({
    where: { opportunityId: { in: [opp.id, opp2.id, opp3.id, opp4.id, opp5.id, opp6.id] } }
  })
  await prisma.recoveryOutcome.deleteMany({
    where: { opportunityId: { in: [opp.id, opp2.id, opp3.id, opp4.id, opp5.id, opp6.id] } }
  })
  await prisma.recoveryExecution.deleteMany({
    where: { opportunityId: { in: [opp.id, opp2.id, opp3.id, opp4.id, opp5.id, opp6.id] } }
  })
  await prisma.recoveryAction.deleteMany({
    where: { opportunityId: { in: [opp.id, opp2.id, opp3.id, opp4.id, opp5.id, opp6.id] } }
  })
  await prisma.recoveryToken.deleteMany({
    where: { opportunityId: { in: [opp.id, opp2.id, opp3.id, opp4.id, opp5.id, opp6.id] } }
  })
  await prisma.recoveryOpportunity.deleteMany({
    where: { id: { in: [opp.id, opp2.id, opp3.id, opp4.id, opp5.id, opp6.id] } }
  })

  console.log('--- ALL TESTS PASSED ---')
  process.exit(0)
}

runTests().catch(e => {
  console.error(e)
  process.exit(1)
})
