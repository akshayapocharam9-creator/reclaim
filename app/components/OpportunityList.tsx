'use client';
import React, { useState } from 'react';
import { RecoveryOpportunity, PriorityLevel } from '../types';
import { useAppContext } from '../context/AppContext';

interface OpportunityListProps {
  opportunities: RecoveryOpportunity[];
  onApprove: (id: string) => void;
  onDismiss?: (id: string) => void;
}

export default function OpportunityList({ opportunities, onApprove, onDismiss }: OpportunityListProps) {
  const { settings } = useAppContext();
  const [selectedOpp, setSelectedOpp] = useState<RecoveryOpportunity | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAction = () => {
    if (!selectedOpp) return;
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      onApprove(selectedOpp.id);
      setSelectedOpp(null);
    }, 800);
  };

  const getPriorityColor = (priority: PriorityLevel) => {
    switch (priority) {
      case 'CRITICAL': return 'text-rose-700 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400 border-rose-200 dark:border-rose-900/50';
      case 'HIGH': return 'text-orange-700 bg-orange-50 dark:bg-orange-950/30 dark:text-orange-400 border-orange-200 dark:border-orange-900/50';
      case 'MEDIUM': return 'text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 border-amber-200 dark:border-amber-900/50';
      case 'LOW': return 'text-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700';
      default: return 'text-gray-700 bg-gray-50 border-gray-200';
    }
  };

  return (
    <>
      <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Recovery Opportunities</h2>
          <span className="text-xs font-medium text-gray-500">{opportunities.length} items</span>
        </div>
        
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {opportunities.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No opportunities found.</div>
          ) : opportunities.map((opp) => (
            <div 
              key={opp.id} 
              onClick={() => setSelectedOpp(opp)}
              className="p-5 hover:bg-gray-50 dark:hover:bg-[#18181b] transition-colors cursor-pointer group"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-semibold text-gray-900 dark:text-white text-lg tracking-tight">
                      ${opp.amount.toLocaleString()}
                    </span>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-200">{opp.customerName}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold border ${getPriorityColor(opp.priority)}`}>
                      {opp.priority}
                    </span>
                  </div>
                  
                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {opp.analysis.problem}
                  </div>
                </div>
                
                <div className="flex-shrink-0 text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                  <span className="text-sm font-medium mr-2">Review</span>
                  <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedOpp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/20 dark:bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#09090b] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-[#09090b]">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Opportunity Review</h3>
              <button onClick={() => setSelectedOpp(null)} className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            
            <div className="p-6 md:p-8 overflow-y-auto max-h-[70vh]">
              <div className="flex items-end justify-between mb-8">
                <div>
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{selectedOpp.customerName}</p>
                  <h4 className="text-4xl font-semibold tracking-tight text-gray-900 dark:text-white">${selectedOpp.amount.toLocaleString()}</h4>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className={`px-2.5 py-1 rounded text-xs uppercase tracking-wider font-semibold border ${getPriorityColor(selectedOpp.priority)}`}>
                    {selectedOpp.priority} PRIORITY
                  </div>
                  <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                    {selectedOpp.analysis.recoveryProbability}% Probability
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <h5 className="text-sm font-medium text-gray-900 dark:text-gray-200 mb-2">Detected Issue</h5>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{selectedOpp.analysis.problem}</p>
                </div>

                <div className="bg-gray-50 dark:bg-[#18181b] p-5 rounded-lg border border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-gray-900 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    <h5 className="text-sm font-medium text-gray-900 dark:text-gray-100">AI Analysis</h5>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">{selectedOpp.analysis.reasoning}</p>
                  
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider mb-1">Agent Recommendation</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-200">{selectedOpp.analysis.recommendedAction}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-[#18181b] flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Review action to queue for recovery.</p>
              </div>
              <div className="flex gap-3 items-center">
                {onDismiss && (
                  <button 
                    onClick={() => {
                      if (selectedOpp) {
                        onDismiss(selectedOpp.id);
                        setSelectedOpp(null);
                      }
                    }}
                    disabled={isProcessing}
                    className="px-5 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    Dismiss
                  </button>
                )}
                {settings.approvalMode === 'agent' ? (
                  <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2.5 rounded-lg border border-emerald-100 dark:border-emerald-900/50">
                    Agent will execute automatically
                  </p>
                ) : (
                  <button 
                    onClick={handleAction}
                    disabled={isProcessing}
                    className="px-5 py-2.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-medium rounded-lg shadow-sm hover:bg-gray-800 dark:hover:bg-gray-100 focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? 'Queuing...' : 'Approve Recovery'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
