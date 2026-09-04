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

  console.log('--- ALL TESTS PASSED ---')
  process.exit(0)
}

runTests().catch(e => {
  console.error(e)
  process.exit(1)
})
