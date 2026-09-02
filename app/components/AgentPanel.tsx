import React from 'react';
import { AgentActivity, RecoveryOpportunity } from '../types';

interface AgentPanelProps {
  activities: AgentActivity[];
  decision: { opportunity: RecoveryOpportunity, explanation: string } | null;
  isActive?: boolean;
}
export default function AgentPanel({ activities, decision, isActive = true }: AgentPanelProps) {
  const latestActivity = activities.length > 0 ? activities[0] : null;
  const previousActivities = activities.length > 1 ? activities.slice(1, 4) : [];

  return (
    <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden flex flex-col h-full">
      <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Agent Intelligence</h2>
        <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full border ${isActive ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-100 dark:border-emerald-900/50' : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
          <div className="relative flex h-1.5 w-1.5">
            {isActive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
            <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${isActive ? 'bg-emerald-500' : 'bg-gray-400'}`}></span>
          </div>
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${isActive ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}`}>
            {isActive ? 'Active' : 'Paused'}
          </span>
        </div>
      </div>
      
      {decision && (
        <div className="p-6 border-b border-gray-100 dark:border-gray-800 bg-blue-50/30 dark:bg-blue-900/10">
          <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-2">Next Best Action</p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-200 mb-2">
            Prioritize {decision.opportunity.customerName} ({decision.opportunity.analysis.problem.toLowerCase()})
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {decision.explanation}
          </p>
        </div>
      )}

      {latestActivity && (
        <div className="p-6 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-[#18181b]/50">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Latest Pipeline Event</p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-200 leading-relaxed mb-4">
            {latestActivity.message}
          </p>
          <div className="flex justify-between items-center mt-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">{latestActivity.timestamp}</span>
            {latestActivity.type === 'alert' && (
              <span className="text-xs font-medium text-rose-600 dark:text-rose-400">Detection Phase</span>
            )}
            {latestActivity.type === 'insight' && (
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Analysis Phase</span>
            )}
            {latestActivity.type === 'action' && (
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Action Phase</span>
            )}
          </div>
        </div>
      )}
      
      <div className="p-6 flex-1 overflow-y-auto">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-4 uppercase tracking-wider">Analysis Log</h3>
        
        <div className="space-y-5">
          {previousActivities.map((activity) => (
            <div key={activity.id} className="flex gap-3">
              <div className="mt-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600"></div>
              </div>
              <div>
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-snug">{activity.message}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{activity.timestamp}</p>
              </div>
            </div>
          ))}
          {previousActivities.length === 0 && (
            <p className="text-sm text-gray-500">No previous activities.</p>
          )}
        </div>
      </div>
    </div>
  );
}
