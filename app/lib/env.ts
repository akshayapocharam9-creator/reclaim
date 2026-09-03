export type AppEnvironment = 'development' | 'test' | 'audit' | 'production'

export interface EnvValidationResult {
  valid: boolean
  environment: AppEnvironment
  executionMode: 'audit' | 'live'
  databaseConfigured: boolean
  authConfigured: boolean
  razorpayConfigured: boolean
  resendConfigured: boolean
  missingRequiredVars: string[]
  warnings: string[]
}

/**
 * Validates the runtime environment strictly without logging or exposing secrets.
 */
export function validateEnvironment(): EnvValidationResult {
  const nodeEnv = process.env.NODE_ENV || 'development'
  const executionMode = (process.env.RECOVERY_EXECUTION_MODE === 'live' ? 'live' : 'audit') as 'audit' | 'live'
  
  let environment: AppEnvironment = 'development'
  if (nodeEnv === 'production') environment = 'production'
  else if (nodeEnv === 'test') environment = 'test'
  else if (executionMode === 'audit') environment = 'audit'

  const missingRequiredVars: string[] = []
  const warnings: string[] = []

  // Core required variables across all environments
  const databaseUrl = process.env.DATABASE_URL
  const databaseConfigured = Boolean(databaseUrl && databaseUrl.length > 5)
  if (!databaseConfigured) {
    missingRequiredVars.push('DATABASE_URL')
  }

  const authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || process.env.SESSION_SECRET
  const authConfigured = Boolean(authSecret && authSecret.length >= 16)
  if (!authConfigured) {
    if (environment === 'production') {
      missingRequiredVars.push('AUTH_SECRET (must be at least 16 characters in production)')
    } else {
      warnings.push('AUTH_SECRET is not set or too short; using dev fallback signature key')
    }
  }

  // Gateway credentials
  const razorpayKeyId = process.env.RAZORPAY_KEY_ID
  const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET
  const razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET
  const razorpayConfigured = Boolean(razorpayKeyId && razorpayKeySecret)

  if (executionMode === 'live' && !razorpayConfigured) {
    if (environment === 'production') {
      missingRequiredVars.push('RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET')
    } else {
      warnings.push('Live execution mode requested, but Razorpay credentials are missing. Payment recovery calls will fail closed.')
    }
  }

  if (environment === 'production' && !razorpayWebhookSecret) {
    warnings.push('RAZORPAY_WEBHOOK_SECRET is not set. Real production webhook verification requires this secret.')
  }

  // Email provider credentials
  const resendApiKey = process.env.RESEND_API_KEY
  const resendConfigured = Boolean(resendApiKey && resendApiKey.startsWith('re_'))
  if (executionMode === 'live' && !resendConfigured) {
    if (environment === 'production') {
      missingRequiredVars.push('RESEND_API_KEY')
    } else {
      warnings.push('Live execution mode requested, but RESEND_API_KEY is missing. Email recovery calls will fail closed.')
    }
  }

  const valid = missingRequiredVars.length === 0

  return {
    valid,
    environment,
    executionMode,
    databaseConfigured,
    authConfigured,
    razorpayConfigured,
    resendConfigured,
    missingRequiredVars,
    warnings
  }
}
