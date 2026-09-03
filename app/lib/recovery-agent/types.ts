export enum RecoveryAction {
  RETRY_PAYMENT = 'RETRY_PAYMENT',
  SEND_PAYMENT_REMINDER = 'SEND_PAYMENT_REMINDER',
  CONTACT_CUSTOMER = 'CONTACT_CUSTOMER',
  ESCALATE = 'ESCALATE',
  MONITOR = 'MONITOR'
}

export enum RecoveryPriority {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW'
}

export enum RecoveryChannel {
  AUTOMATED = 'AUTOMATED',
  EMAIL = 'EMAIL',
  MANUAL = 'MANUAL',
  NONE = 'NONE'
}

export interface RecoveryRecommendation {
  opportunityId: string;
  recommendedAction: RecoveryAction;
  priority: RecoveryPriority;
  urgency: 'IMMEDIATE' | 'HIGH' | 'NORMAL' | 'LOW';
  reason: string;
  expectedRecoveryAmountMinor: number;
  suggestedChannel: RecoveryChannel;
  confidence: number;
  generatedAt: string;
}
