import { RecoveryOpportunity, AgentActivity } from '../types';

export class ReclaimAgent {
  
  public determineNextBestAction(opportunities: RecoveryOpportunity[]): { opportunity: RecoveryOpportunity, explanation: string } | null {
    const actionableOpps = opportunities.filter(o => o.status === 'pending');
    
    if (actionableOpps.length === 0) return null;

    // The intelligence engine already sorted them by priority, but the agent makes the final call
    // based on immediate recoverable value (Probability * Amount)
    const bestOpp = actionableOpps.reduce((prev, curr) => {
      const prevEV = prev.amount * (prev.analysis.recoveryProbability / 100);
      const currEV = curr.amount * (curr.analysis.recoveryProbability / 100);
      return (currEV > prevEV) ? curr : prev;
    });

    const explanation = `$${bestOpp.amount.toLocaleString()} at risk with ${bestOpp.analysis.recoveryProbability}% recovery probability. High expected value.`;
    
    return {
      opportunity: bestOpp,
      explanation
    };
  }

  public generateActivities(opportunities: RecoveryOpportunity[]): AgentActivity[] {
    const activities: AgentActivity[] = [];
    
    // Reverse to process chronologically if they were created top-down
    const processList = [...opportunities].reverse();
    
    processList.forEach((opp, index) => {
      // Simulate historical agent tracking
      // Let's create an alert for the detection, and an insight for the analysis
      
      const timeOffset = index * 5; // Fake minutes ago
      
      // Detection Activity
      activities.unshift({
        id: `act-det-${opp.id}`,
        timestamp: `${timeOffset + 2} mins ago`,
        message: `Detected ${opp.analysis.problem.toLowerCase()} — ${opp.customerName} ($${opp.amount.toLocaleString()})`,
        type: 'alert'
      });

      // Insight / Analysis Activity
      activities.unshift({
        id: `act-ins-${opp.id}`,
        timestamp: `${timeOffset} mins ago`,
        message: `Analysis complete: ${opp.analysis.recoveryProbability}% probability. Classified as ${opp.priority}.`,
        type: 'insight'
      });
    });

    return activities.slice(0, 10); // Keep only the latest 10
  }
}
