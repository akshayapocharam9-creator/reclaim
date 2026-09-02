import { RevenueEvent, RecoveryOpportunity, PriorityLevel, RecoveryAnalysis } from '../types';

export class RevenueIntelligenceEngine {
  
  public analyzeEvents(events: RevenueEvent[]): RecoveryOpportunity[] {
    return events.map(event => {
      const probability = this.calculateRecoveryProbability(event);
      const priority = this.calculatePriority(event, probability);
      const analysis = this.generateAnalysis(event, probability);
      
      return {
        id: `opp-${event.id}`,
        eventId: event.id,
        customerName: event.customerName,
        amount: event.amount,
        priority,
        analysis,
        status: 'pending' as const,
        createdAt: new Date().toISOString()
      };
    }).sort((a, b) => this.getPriorityScore(b.priority) - this.getPriorityScore(a.priority));
  }

  private calculateRecoveryProbability(event: RevenueEvent): number {
    let base = 50;
    
    switch (event.type) {
      case 'payment_failed':
        // High probability if it's a card error but customer is active
        base = event.metadata?.previousFailures < 3 ? 85 : 40;
        break;
      case 'invoice_unpaid':
        base = event.metadata?.daysPastDue <= 30 ? 75 : 45;
        break;
      case 'subscription_expired':
        base = event.metadata?.usageDropoff === false ? 90 : 30;
        break;
      case 'cart_abandoned':
        base = event.metadata?.checkoutStep === 'billing_address' ? 65 : 25;
        break;
      case 'churn_signal':
        base = event.metadata?.usageDropPercent > 50 ? 35 : 60;
        break;
    }
    
    return Math.min(Math.max(base, 0), 100);
  }

  private calculatePriority(event: RevenueEvent, probability: number): PriorityLevel {
    // Scoring factors: Amount, Probability, Age
    const amountScore = event.amount > 20000 ? 3 : (event.amount > 10000 ? 2 : 1);
    const probScore = probability > 80 ? 3 : (probability > 50 ? 2 : 1);
    
    // Calculate hours since event
    const hoursOld = (Date.now() - new Date(event.timestamp).getTime()) / (1000 * 60 * 60);
    const urgencyScore = hoursOld < 24 ? 3 : (hoursOld < 72 ? 2 : 1);

    const totalScore = amountScore + probScore + urgencyScore;

    if (totalScore >= 8) return 'CRITICAL';
    if (totalScore >= 6) return 'HIGH';
    if (totalScore >= 4) return 'MEDIUM';
    return 'LOW';
  }

  private getPriorityScore(priority: PriorityLevel): number {
    switch (priority) {
      case 'CRITICAL': return 4;
      case 'HIGH': return 3;
      case 'MEDIUM': return 2;
      case 'LOW': return 1;
    }
  }

  private generateAnalysis(event: RevenueEvent, probability: number): RecoveryAnalysis {
    let problem = '';
    let reasoning = '';
    let recommendedAction = '';

    switch (event.type) {
      case 'payment_failed':
        problem = 'Payment failed for an active customer.';
        reasoning = `Customer has a ${event.metadata?.customerTenureMonths || 12}-month history. The failure appears recoverable as usage remains high. Gateway returned error ${event.metadata?.errorCode}.`;
        recommendedAction = 'Retry payment and notify customer with a card update link.';
        break;
      case 'invoice_unpaid':
        problem = `Invoice is ${event.metadata?.daysPastDue || 0} days past due.`;
        reasoning = `The customer typically pays around day ${event.metadata?.averagePaymentDays || 30}. A polite nudge usually resolves this without escalating to collections.`;
        recommendedAction = 'Initiate automated agent negotiation sequence.';
        break;
      case 'subscription_expired':
        problem = 'Annual subscription lapsed without explicit cancellation.';
        reasoning = `Usage metrics remained high (active users: ${event.metadata?.activeUsers}) until expiration. This is highly likely an administrative oversight.`;
        recommendedAction = 'Direct outreach from Account Executive.';
        break;
      case 'churn_signal':
        problem = 'High risk of churn detected based on usage patterns.';
        reasoning = `Platform usage dropped by ${event.metadata?.usageDropPercent}% over the last few weeks. Immediate intervention required.`;
        recommendedAction = 'Schedule immediate CSM review and health check.';
        break;
      case 'cart_abandoned':
        problem = 'High-value cart abandoned during checkout.';
        reasoning = `User encountered a validation error on the ${event.metadata?.checkoutStep} step and dropped off.`;
        recommendedAction = 'Send targeted assistance email offering help with billing.';
        break;
    }

    return {
      problem,
      financialImpact: event.amount,
      reasoning,
      recoveryProbability: probability,
      recommendedAction
    };
  }
}
