import { AIProvider, AIReasoningInput, AIReasoningOutput } from './types'

/**
 * Deterministic fallback provider.
 * Activated when external API keys are missing, or when external calls fail/timeout.
 */
export class FallbackAIProvider implements AIProvider {
  name = 'deterministic-fallback'

  async generateReasoning(input: AIReasoningInput): Promise<AIReasoningOutput> {
    const isHighPriority = input.priority === 'CRITICAL' || input.priority === 'HIGH'
    const customer = input.customerName || 'valued customer'
    const amountStr = `${input.currency} ${input.amountAtRiskMajor.toLocaleString()}`

    let riskExplanation = `Revenue of ${amountStr} is currently stalled due to ${input.opportunityType.replace(/_/g, ' ').toLowerCase()}.`
    if (input.failureCount && input.failureCount > 1) {
      riskExplanation += ` Multiple consecutive attempts (${input.failureCount}) have failed, suggesting systemic card or authorization issues.`
    } else {
      riskExplanation += ` This appears to be an isolated or early-stage transaction friction.`
    }

    let recommendedCommunication = 'Automated retry communication via email.'
    let suggestedCustomerMessage = `Hi ${customer}, we noticed an issue processing your recent payment of ${amountStr}. Please review your billing details to keep your service active.`

    if (input.recommendedAction === 'CONTACT_CUSTOMER' || input.suggestedChannel === 'MANUAL') {
      recommendedCommunication = 'Direct personalized outreach by account representative.'
      suggestedCustomerMessage = `Hello ${customer}, your payment of ${amountStr} was unable to process. We would appreciate the opportunity to help you update your payment method directly at your convenience.`
    } else if (input.opportunityType === 'CHECKOUT_ABANDONMENT') {
      recommendedCommunication = 'Gentle checkout abandonment recovery email.'
      suggestedCustomerMessage = `Hi ${customer}, your items are waiting! Complete your order of ${amountStr} with a quick click here to resume your checkout.`
    } else if (input.opportunityType === 'SUBSCRIPTION_FAILURE') {
      recommendedCommunication = 'Subscription renewal grace period notice.'
      suggestedCustomerMessage = `Hi ${customer}, your subscription renewal of ${amountStr} could not be completed. Update your payment information before your next billing cycle to avoid service disruption.`
    }

    return {
      summary: `${input.priority} priority ${input.opportunityType.replace(/_/g, ' ')} of ${amountStr}. Recommendation: ${input.recommendedAction.replace(/_/g, ' ')}.`,
      riskExplanation,
      reasoning: `Deterministic analysis indicates ${input.deterministicReason} Prompt intervention via ${input.suggestedChannel} maximizes recovery probability.`,
      recommendedCommunication,
      suggestedCustomerMessage,
      confidence: isHighPriority ? 0.92 : 0.82,
      provider: 'deterministic-engine',
      model: 'rule-based-v1',
      generatedAt: new Date().toISOString(),
      isFallback: true
    }
  }
}

/**
 * Gemini Provider via official Google Generative Language REST API.
 */
export class GeminiProvider implements AIProvider {
  name = 'gemini'
  private apiKey: string
  private model: string

  constructor(apiKey: string, model: string = 'gemini-1.5-flash') {
    this.apiKey = apiKey
    this.model = model
  }

  async generateReasoning(input: AIReasoningInput): Promise<AIReasoningOutput> {
    const prompt = buildSystemPrompt(input)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 6000)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2
          }
        })
      })

      if (!res.ok) {
        const errorBody = await res.text()
        throw new Error(`Gemini API HTTP ${res.status}: ${errorBody}`)
      }

      const json = await res.json()
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) {
        throw new Error('Empty response from Gemini API')
      }

      const parsed = JSON.parse(text)
      return {
        summary: String(parsed.summary || `Recovery intelligence for ${input.opportunityType}`),
        riskExplanation: String(parsed.riskExplanation || input.deterministicReason),
        reasoning: String(parsed.reasoning || input.deterministicReason),
        recommendedCommunication: String(parsed.recommendedCommunication || 'Standard outreach'),
        suggestedCustomerMessage: String(parsed.suggestedCustomerMessage || 'Please update your payment details.'),
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.88,
        provider: 'gemini',
        model: this.model,
        generatedAt: new Date().toISOString(),
        isFallback: false
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

/**
 * OpenAI Provider via Chat Completions REST API.
 */
export class OpenAIProvider implements AIProvider {
  name = 'openai'
  private apiKey: string
  private model: string

  constructor(apiKey: string, model: string = 'gpt-4o-mini') {
    this.apiKey = apiKey
    this.model = model
  }

  async generateReasoning(input: AIReasoningInput): Promise<AIReasoningOutput> {
    const prompt = buildSystemPrompt(input)
    const url = 'https://api.openai.com/v1/chat/completions'

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 6000)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are an autonomous revenue recovery intelligence assistant for a SaaS merchant. Respond strictly with JSON matching the requested schema.'
            },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2
        })
      })

      if (!res.ok) {
        const errorBody = await res.text()
        throw new Error(`OpenAI API HTTP ${res.status}: ${errorBody}`)
      }

      const json = await res.json()
      const content = json.choices?.[0]?.message?.content
      if (!content) {
        throw new Error('Empty response from OpenAI API')
      }

      const parsed = JSON.parse(content)
      return {
        summary: String(parsed.summary || `Recovery intelligence for ${input.opportunityType}`),
        riskExplanation: String(parsed.riskExplanation || input.deterministicReason),
        reasoning: String(parsed.reasoning || input.deterministicReason),
        recommendedCommunication: String(parsed.recommendedCommunication || 'Standard outreach'),
        suggestedCustomerMessage: String(parsed.suggestedCustomerMessage || 'Please update your payment details.'),
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.88,
        provider: 'openai',
        model: this.model,
        generatedAt: new Date().toISOString(),
        isFallback: false
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

function buildSystemPrompt(input: AIReasoningInput): string {
  return `Analyze the following revenue loss opportunity and generate structured recovery guidance.

Context:
- Type: ${input.opportunityType}
- Amount at Risk: ${input.currency} ${input.amountAtRiskMajor}
- Expected Recoverable: ${input.currency} ${input.expectedRecoveryMajor}
- Priority: ${input.priority} (Urgency: ${input.urgency})
- Recommended Action: ${input.recommendedAction} (Channel: ${input.suggestedChannel})
- Deterministic Reason: ${input.deterministicReason}
- Customer Name: ${input.customerName || 'Anonymous / Not provided'}
- Failure Count: ${input.failureCount || 1}
- Last Failure Code: ${input.lastFailureReason || 'N/A'}

Respond strictly with a valid JSON object containing:
{
  "summary": "1-2 sentence executive overview of what happened and the recommended strategy",
  "riskExplanation": "Clear explanation of why this revenue is in danger of being permanently lost",
  "reasoning": "Nuanced strategic reasoning for why the recommended action and channel are optimal",
  "recommendedCommunication": "Communication tone, timing, and strategy instructions for the operator",
  "suggestedCustomerMessage": "A professional, polite, ready-to-send draft message to the customer addressing the payment issue",
  "confidence": 0.90
}`
}

/**
 * Factory to select the active AI provider based on available environment variables.
 */
export function getAIProvider(): AIProvider {
  const geminiKey = process.env.GEMINI_API_KEY
  if (geminiKey) {
    return new GeminiProvider(geminiKey)
  }

  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    return new OpenAIProvider(openaiKey)
  }

  return new FallbackAIProvider()
}
