import { ActionType } from '@prisma/client'
import { ExecutionMode, RecoveryExecutionProvider } from './types'
import { SimulationExecutionProvider } from './providers/simulation-provider'
import { EmailExecutionProvider } from './providers/email-provider'
import { PaymentExecutionProvider } from './providers/payment-provider'

export class ProviderRegistry {
  private static providers: RecoveryExecutionProvider[] = [
    new EmailExecutionProvider(),
    new PaymentExecutionProvider(),
    new SimulationExecutionProvider() // fallback simulation
  ]

  /**
   * Resolves the configured execution mode from environment.
   * Default MUST strictly be 'audit'.
   */
  public static getExecutionMode(): ExecutionMode {
    const rawMode = process.env.RECOVERY_EXECUTION_MODE?.toLowerCase().trim()
    if (rawMode === 'live') {
      return 'live'
    }
    return 'audit'
  }

  /**
   * Resolves the appropriate provider for a given action and channel.
   */
  public static getProvider(actionType: ActionType, channel?: string): RecoveryExecutionProvider {
    for (const provider of this.providers) {
      if (provider.supports(actionType, channel)) {
        return provider
      }
    }
    return new SimulationExecutionProvider()
  }
}
