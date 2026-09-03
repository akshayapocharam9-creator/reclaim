/* eslint-disable @typescript-eslint/no-unused-vars */
import { ActionType, ExecutionStatus } from '@prisma/client'
import { ExecutionRequest, ExecutionResult, RecoveryExecutionProvider } from '../types'

export class SimulationExecutionProvider implements RecoveryExecutionProvider {
  public readonly name = 'SIMULATION_AUDIT_PROVIDER'

  public supports(_actionType: ActionType, _channel?: string): boolean {
    // Simulation provider supports all action types and channels safely
    return true
  }

  public async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const isPayment = request.actionType === ActionType.RETRY_PAYMENT || request.actionType === ActionType.RETRY_SUBSCRIPTION
    const refPrefix = isPayment ? 'sim_pay' : 'sim_msg'
    const externalReference = `${refPrefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`

    // Generate safe simulation metadata
    const metadata = {
      simulated: true,
      simulationMode: request.mode,
      channel: request.channel,
      actionType: request.actionType,
      targetRecipient: request.customer?.email || request.customer?.phone || 'customer_contact',
      amountMinor: request.amountMinor,
      currency: request.currency,
      timestamp: new Date().toISOString()
    }

    return {
      success: true,
      status: ExecutionStatus.SUCCEEDED,
      externalReference,
      providerName: this.name,
      mode: request.mode,
      metadata,
      executedAt: new Date()
    }
  }
}
