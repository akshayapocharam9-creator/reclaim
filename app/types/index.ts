export type EventType = 'payment_failed' | 'invoice_unpaid' | 'subscription_expired' | 'cart_abandoned' | 'churn_signal';
export type PriorityLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type RecoveryStatus = 'pending' | 'queued_for_recovery' | 'in_progress' | 'recovered' | 'lost' | 'dismissed';

export type IntegrationStatus = 'not_connected' | 'connecting' | 'connected';

export interface Integration {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  syncData: string[];
  status: IntegrationStatus;
  lastSync?: string;
}

export interface AppSettings {
  approvalMode: 'manual' | 'agent';
  notifications: 'important' | 'all' | 'none';
  riskThreshold: number;
  agentActive: boolean;
}
export interface RevenueEvent {
  id: string;
  type: EventType;
  customerId: string;
  customerName: string;
  amount: number;
  timestamp: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
}

export interface RecoveryAnalysis {
  problem: string;
  financialImpact: number;
  reasoning: string;
  recoveryProbability: number;
  recommendedAction: string;
}

export interface RecoveryOpportunity {
  id: string;
  eventId: string;
  customerName: string;
  amount: number;
  priority: PriorityLevel;
  analysis: RecoveryAnalysis;
  status: RecoveryStatus;
  createdAt: string;
  dunningStep?: number;
  dunningStatus?: string;
  dunningScheduledAt?: string | null;
  hasRecoveryPortal?: boolean;
}

export interface AgentActivity {
  id: string;
  timestamp: string;
  message: string;
  type: 'alert' | 'insight' | 'action' | 'success';
}

export interface DashboardMetrics {
  revenueAtRisk: number;
  recoverableRevenue: number;
  revenueRecovered: number;
  recoveryRate: number; // percentage
}

export interface ChartDataPoint {
  month: string;
  recovered: number;
  atRisk: number;
}
