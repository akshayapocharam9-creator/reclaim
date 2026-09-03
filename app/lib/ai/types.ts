export interface AIReasoningInput {
  opportunityId: string
  opportunityType: string
  amountAtRiskMajor: number
  expectedRecoveryMajor: number
  currency: string
  priority: string
  urgency: string
  recommendedAction: string
  suggestedChannel: string
  deterministicReason: string
  failureCount?: number
  customerName?: string
  lastFailureReason?: string
  daysSinceDetection?: number
}

export interface AIReasoningOutput {
  summary: string
  riskExplanation: string
  reasoning: string
  recommendedCommunication: string
  suggestedCustomerMessage: string
  confidence: number
  provider: string
  model: string
  generatedAt: string
  isFallback: boolean
}

export interface AIProvider {
  name: string
  generateReasoning(input: AIReasoningInput): Promise<AIReasoningOutput>
}
