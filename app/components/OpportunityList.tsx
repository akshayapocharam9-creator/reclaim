/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/set-state-in-effect */
'use client';
import React, { useState, useEffect } from 'react';
import { RecoveryOpportunity, PriorityLevel, RecoveryStatus } from '../types';
import { useAuth } from '../context/AuthContext';

interface OpportunityListProps {
  opportunities: RecoveryOpportunity[];
  onApprove: (id: string) => void;
  onDismiss?: (id: string) => void;
}

export default function OpportunityList({ opportunities, onApprove, onDismiss }: OpportunityListProps) {
  const { role } = useAuth();
  const isPrivileged = role === 'OWNER' || role === 'ADMIN';

  const [selectedOpp, setSelectedOpp] = useState<RecoveryOpportunity | null>(null);
  const [activeTab, setActiveTab] = useState<'review' | 'timeline'>('review');
  const [recommendation, setRecommendation] = useState<any>(null);
  const [actionState, setActionState] = useState<any>(null);
  const [aiReasoning, setAiReasoning] = useState<any>(null);
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [isLoadingRec, setIsLoadingRec] = useState(false);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConfirmExecute, setShowConfirmExecute] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchActionState = async (oppId: string) => {
    try {
      const res = await fetch(`/api/revenue/opportunities/${oppId}/actions`);
      if (res.ok) {
        const data = await res.json();
        setActionState(data);
      }
    } catch (err) {
      console.error('Failed to fetch action state:', err);
    }
  };

  const fetchTimeline = async (oppId: string) => {
    setIsLoadingTimeline(true);
    try {
      const res = await fetch(`/api/revenue/opportunities/${oppId}/timeline`);
      if (res.ok) {
        const data = await res.json();
        setTimelineEvents(data.timeline || []);
      }
    } catch (err) {
      console.error('Failed to fetch timeline:', err);
    } finally {
      setIsLoadingTimeline(false);
    }
  };

  useEffect(() => {
    if (selectedOpp) {
      setActiveTab('review');
      setIsLoadingRec(true);
      setIsLoadingAI(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      setIsCopied(false);
      setShowConfirmExecute(false);
      setTimelineEvents([]);

      Promise.all([
        fetch(`/api/revenue/opportunities/${selectedOpp.id}/recommendation`)
          .then(res => res.json())
          .then(data => setRecommendation(data)),
        fetchActionState(selectedOpp.id)
      ])
        .catch(err => {
          console.error(err);
        })
        .finally(() => {
          setIsLoadingRec(false);
        });

      fetch(`/api/revenue/opportunities/${selectedOpp.id}/ai`)
        .then(res => res.json())
        .then(data => {
          if (data && data.aiReasoning) {
            setAiReasoning(data.aiReasoning);
          }
        })
        .catch(err => {
          console.error('Failed to fetch AI reasoning:', err);
        })
        .finally(() => {
          setIsLoadingAI(false);
        });
    } else {
      setRecommendation(null);
      setActionState(null);
      setAiReasoning(null);
      setTimelineEvents([]);
      setErrorMessage(null);
      setSuccessMessage(null);
      setIsCopied(false);
      setShowConfirmExecute(false);
    }
  }, [selectedOpp]);

  const handleTabSwitch = (tab: 'review' | 'timeline') => {
    setActiveTab(tab);
    if (tab === 'timeline' && selectedOpp && timelineEvents.length === 0) {
      fetchTimeline(selectedOpp.id);
    }
  };

  const handleTakeAction = async () => {
    if (!selectedOpp) return;
    setIsProcessing(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/revenue/opportunities/${selectedOpp.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: recommendation ? `Action initiated: ${recommendation.reason}` : 'Recovery action initiated'
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to initiate recovery action');
      }

      setSuccessMessage(data.message || 'Recovery action initiated successfully');
      await fetchActionState(selectedOpp.id);
      setSelectedOpp(prev => prev ? { ...prev, status: 'in_progress' as RecoveryStatus } : null);
      onApprove(selectedOpp.id);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error initiating action');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecuteRecovery = async () => {
    if (!selectedOpp) return;
    setIsProcessing(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/revenue/opportunities/${selectedOpp.id}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionId: actionState?.latestAction?.id,
          messageSubject: recommendation ? `Recovery Notice: Payment for ${selectedOpp.customerName}` : undefined,
          messageBody: aiReasoning?.suggestedCustomerMessage || recommendation?.reason
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Recovery execution failed');
      }

      setSuccessMessage(data.message || 'Recovery action executed successfully');
      await fetchActionState(selectedOpp.id);
      if (activeTab === 'timeline') {
        await fetchTimeline(selectedOpp.id);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error running execution');
    } finally {
      setIsProcessing(false);
      setShowConfirmExecute(false);
    }
  };

  const handleRetryExecution = async (executionId: string) => {
    setIsProcessing(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/revenue/executions/${executionId}/retry`, {
        method: 'POST'
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Retry failed');
      }

      setSuccessMessage('Execution retried successfully');
      if (selectedOpp) {
        await fetchActionState(selectedOpp.id);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error retrying execution');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleScheduleCadence = async () => {
    if (!selectedOpp) return;
    setIsProcessing(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/recoveries/${selectedOpp.id}/cadence`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to initialize dunning cadence');
      }
      setSuccessMessage('Dunning cadence initialized successfully (Step 1 active)');
      await fetchActionState(selectedOpp.id);
      if (activeTab === 'timeline') {
        await fetchTimeline(selectedOpp.id);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error scheduling cadence');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApprovePendingAction = async () => {
    if (!selectedOpp) return;
    setIsProcessing(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/revenue/opportunities/${selectedOpp.id}/approve`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to approve action');
      }
      setSuccessMessage(data.message || 'Recovery action approved and dispatched');
      await fetchActionState(selectedOpp.id);
      if (activeTab === 'timeline') {
        await fetchTimeline(selectedOpp.id);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error approving action');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRejectPendingAction = async () => {
    if (!selectedOpp) return;
    setIsProcessing(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/revenue/opportunities/${selectedOpp.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Rejected by operator' })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reject action');
      }
      setSuccessMessage(data.message || 'Recovery action rejected');
      await fetchActionState(selectedOpp.id);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error rejecting action');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDismiss = async () => {
    if (!selectedOpp) return;
    setIsProcessing(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/revenue/opportunities/${selectedOpp.id}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Dismissed by operator' })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to dismiss opportunity');
      }

      setSuccessMessage('Opportunity dismissed');
      await fetchActionState(selectedOpp.id);
      setSelectedOpp(prev => prev ? { ...prev, status: 'dismissed' as RecoveryStatus } : null);
      if (onDismiss) onDismiss(selectedOpp.id);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error dismissing opportunity');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMarkRecovered = async () => {
    if (!selectedOpp) return;
    setIsProcessing(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/revenue/opportunities/${selectedOpp.id}/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'Confirmed recovered via operator review' })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to mark recovered');
      }

      setSuccessMessage('Opportunity marked as recovered!');
      await fetchActionState(selectedOpp.id);
      setSelectedOpp(prev => prev ? { ...prev, status: 'recovered' as RecoveryStatus } : null);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error marking as recovered');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMarkFailed = async () => {
    if (!selectedOpp) return;
    setIsProcessing(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/revenue/opportunities/${selectedOpp.id}/fail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ failureReason: 'Action attempt was unsuccessful' })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to mark failed');
      }

      setSuccessMessage('Opportunity marked as failed');
      await fetchActionState(selectedOpp.id);
      setSelectedOpp(prev => prev ? { ...prev, status: 'lost' as RecoveryStatus } : null);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error marking as failed');
    } finally {
      setIsProcessing(false);
    }
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

  const getExecutionBadgeColor = (status: string) => {
    switch (status) {
      case 'SUCCEEDED': return 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800';
      case 'RUNNING': return 'bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border-blue-300 dark:border-blue-800 animate-pulse';
      case 'QUEUED': return 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800';
      case 'FAILED': return 'bg-rose-100 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-800';
      case 'CANCELLED': return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400 border-gray-300 dark:border-gray-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const currentStatus = actionState?.opportunityStatus || (selectedOpp?.status === 'in_progress' ? 'IN_PROGRESS' : selectedOpp?.status === 'recovered' ? 'RECOVERED' : selectedOpp?.status === 'dismissed' ? 'DISMISSED' : 'DETECTED');
  const latestExecution = actionState?.latestExecution;

  return (
    <>
      <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Recovery Opportunities</h2>
          <span className="text-xs font-medium text-gray-500">{opportunities.length} items</span>
        </div>
        
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {opportunities.length === 0 ? (
            <div className="py-16 px-6 text-center">
              <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 flex items-center justify-center mx-auto mb-3 text-lg font-bold">
                ✓
              </div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Zero Revenue Leaks Pending</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
                No active payment failures or recovery opportunities meet the current filter criteria.
              </p>
            </div>
          ) : opportunities.map((opp) => (
            <div 
              key={opp.id} 
              onClick={() => setSelectedOpp(opp)}
              className="p-5 hover:bg-gray-50 dark:hover:bg-[#18181b] transition-colors cursor-pointer group"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-3 mb-1">
                    <span className="font-semibold text-gray-900 dark:text-white text-lg tracking-tight">
                      ${opp.amount.toLocaleString()}
                    </span>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-200">{opp.customerName}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold border ${getPriorityColor(opp.priority)}`}>
                      {opp.priority}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                      {opp.status.replace(/_/g, ' ')}
                    </span>
                    {opp.dunningStep ? (
                      <span className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold border border-purple-200 text-purple-700 bg-purple-50 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800">
                        Dunning: Step {opp.dunningStep} (Day {opp.dunningStep === 1 ? 1 : opp.dunningStep === 2 ? 3 : 7})
                      </span>
                    ) : null}
                    {opp.hasRecoveryPortal && (
                      <span className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold border border-emerald-200 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                        Portal Link Active
                      </span>
                    )}
                  </div>
                  
                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-3">
                    <span>{opp.analysis.problem}</span>
                    {opp.dunningScheduledAt && opp.dunningStatus === 'SCHEDULED' && (
                      <span className="text-xs text-purple-600 dark:text-purple-400 font-mono">
                        · Next Cadence: {new Date(opp.dunningScheduledAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="flex-shrink-0 text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white transition-colors flex items-center gap-2">
                  <span className="text-sm font-medium">Review & Operations</span>
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
            
            {/* MODAL HEADER WITH TAB SWITCHER */}
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-[#09090b]">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Recovery Control Plane</h3>
                  <div className="flex items-center bg-gray-200 dark:bg-gray-800 p-0.5 rounded-lg">
                    <button
                      onClick={() => handleTabSwitch('review')}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${activeTab === 'review' ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-xs' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                      Review & Actions
                    </button>
                    <button
                      onClick={() => handleTabSwitch('timeline')}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${activeTab === 'timeline' ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-xs' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                      Chronological Timeline
                    </button>
                  </div>
                </div>
                <span className="text-xs text-gray-500 font-mono">ID: {selectedOpp.id}</span>
              </div>
              <button onClick={() => setSelectedOpp(null)} className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            
            <div className="p-6 md:p-8 overflow-y-auto max-h-[70vh]">
              {errorMessage && (
                <div className="mb-4 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-400 text-sm">
                  {errorMessage}
                </div>
              )}

              {successMessage && (
                <div className="mb-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-400 text-sm">
                  {successMessage}
                </div>
              )}

              <div className="flex items-end justify-between mb-8">
                <div>
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{selectedOpp.customerName}</p>
                  <h4 className="text-4xl font-semibold tracking-tight text-gray-900 dark:text-white">${selectedOpp.amount.toLocaleString()}</h4>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`px-2.5 py-1 rounded text-xs uppercase tracking-wider font-semibold border ${getPriorityColor(selectedOpp.priority)}`}>
                      {selectedOpp.priority} PRIORITY
                    </div>
                    <div className="px-2.5 py-1 rounded text-xs uppercase tracking-wider font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                      STATUS: {currentStatus}
                    </div>
                  </div>
                  <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                    {selectedOpp.analysis.recoveryProbability}% Probability
                  </div>
                </div>
              </div>

              {activeTab === 'timeline' ? (
                /* CHRONOLOGICAL CUSTOMER & REVENUE TIMELINE */
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h5 className="text-sm font-semibold text-gray-900 dark:text-white">Customer & Revenue Event Path</h5>
                    <button
                      onClick={() => fetchTimeline(selectedOpp.id)}
                      disabled={isLoadingTimeline}
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      {isLoadingTimeline ? 'Refreshing...' : 'Refresh Timeline'}
                    </button>
                  </div>

                  {isLoadingTimeline ? (
                    <div className="py-8 text-center text-xs text-gray-500 animate-pulse">Loading chronological path...</div>
                  ) : timelineEvents.length === 0 ? (
                    <div className="py-8 text-center text-xs text-gray-500">No events logged in timeline.</div>
                  ) : (
                    <div className="space-y-4">
                      {timelineEvents.map((evt, idx) => (
                        <div key={evt.id || idx} className="flex gap-4 relative">
                          {idx !== timelineEvents.length - 1 && (
                            <div className="absolute top-6 left-2 w-[1px] h-full bg-gray-200 dark:bg-gray-800 -z-10"></div>
                          )}
                          <div className="mt-1 shrink-0">
                            <div className="w-4 h-4 rounded-full border-2 border-white dark:border-[#09090b] z-10 bg-indigo-500"></div>
                          </div>
                          <div className="flex-1 bg-gray-50 dark:bg-[#18181b] p-3 rounded-lg border border-gray-200 dark:border-gray-800 text-xs">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-gray-900 dark:text-gray-100">{evt.title}</span>
                              <span className="text-[10px] text-gray-400 font-mono">
                                {new Date(evt.timestamp).toLocaleString()}
                              </span>
                            </div>
                            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">{evt.description}</p>
                            <div className="flex items-center gap-2 mt-2">
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                                {evt.stage}
                              </span>
                              {evt.status && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                                  {evt.status}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* REVIEW & ACTIONS CONTENT */
                <div className="space-y-6">
                  <div>
                    <h5 className="text-sm font-medium text-gray-900 dark:text-gray-200 mb-2">Detected Issue</h5>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{selectedOpp.analysis.problem}</p>
                  </div>

                  {/* 1. DETERMINISTIC RECOMMENDATION (Authoritative Source of Truth) */}
                  <div className="bg-gray-50 dark:bg-[#18181b] p-5 rounded-lg border border-gray-100 dark:border-gray-800">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-gray-900 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                        <h5 className="text-sm font-medium text-gray-900 dark:text-gray-100">Deterministic Recommendation</h5>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
                        Source of Truth
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">{selectedOpp.analysis.reasoning}</p>
                    
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                      {isLoadingRec ? (
                        <p className="text-sm text-gray-500 animate-pulse">Generating recommendation...</p>
                      ) : recommendation && !recommendation.error ? (
                        <div className="space-y-3">
                          <div className="flex gap-4">
                            <div className="flex-1">
                              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider mb-1">Recommended Action</p>
                              <p className="text-sm font-semibold text-gray-900 dark:text-gray-200">{recommendation.recommendedAction?.replace(/_/g, ' ')}</p>
                            </div>
                            <div className="flex-1">
                              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider mb-1">Urgency</p>
                              <p className="text-sm font-semibold text-gray-900 dark:text-gray-200">{recommendation.urgency}</p>
                            </div>
                            <div className="flex-1">
                              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider mb-1">Channel</p>
                              <p className="text-sm font-semibold text-gray-900 dark:text-gray-200">{recommendation.suggestedChannel?.replace(/_/g, ' ')}</p>
                            </div>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider mb-1">Reasoning</p>
                            <p className="text-sm text-gray-600 dark:text-gray-400">{recommendation.reason}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider mb-1">Expected Recovery</p>
                            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                              ${(recommendation.expectedRecoveryAmountMinor / 100).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-red-500">Failed to load recommendation.</p>
                      )}
                    </div>
                  </div>

                  {/* 2. AI-ASSISTED INTELLIGENCE SECTION (Advisory Only) */}
                  <div className="bg-gradient-to-br from-indigo-50/70 via-purple-50/40 to-white dark:from-indigo-950/20 dark:via-purple-950/10 dark:to-[#18181b] p-5 rounded-lg border border-indigo-100 dark:border-indigo-900/40 shadow-xs">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="p-1 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
                          </svg>
                        </div>
                        <div>
                          <h5 className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI-Assisted Recovery Advisory</h5>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">Advisory explanation and draft. AI never executes actions directly.</p>
                        </div>
                      </div>
                      <div>
                        {aiReasoning?.isFallback ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/50">
                            Deterministic Fallback
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                            AI Advisory
                          </span>
                        )}
                      </div>
                    </div>

                    {isLoadingAI ? (
                      <div className="space-y-3 py-3 animate-pulse">
                        <div className="h-4 bg-indigo-100/70 dark:bg-indigo-900/30 rounded w-3/4"></div>
                        <div className="h-3 bg-indigo-100/50 dark:bg-indigo-900/20 rounded w-full"></div>
                      </div>
                    ) : aiReasoning ? (
                      <div className="space-y-4 text-xs">
                        <div>
                          <p className="font-semibold text-gray-800 dark:text-gray-200 mb-1">Executive Summary</p>
                          <p className="text-gray-600 dark:text-gray-300 leading-relaxed">{aiReasoning.summary}</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-indigo-100/60 dark:border-indigo-900/30">
                          <div>
                            <p className="font-semibold text-gray-800 dark:text-gray-200 mb-1">Why Revenue Is At Risk</p>
                            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">{aiReasoning.riskExplanation}</p>
                          </div>
                          <div>
                            <p className="font-semibold text-gray-800 dark:text-gray-200 mb-1">Recommended Outreach Strategy</p>
                            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">{aiReasoning.recommendedCommunication}</p>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-indigo-100/60 dark:border-indigo-900/30">
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="font-semibold text-gray-800 dark:text-gray-200">Draft Customer Outreach</p>
                            <button
                              type="button"
                              onClick={() => {
                                if (aiReasoning.suggestedCustomerMessage) {
                                  navigator.clipboard?.writeText(aiReasoning.suggestedCustomerMessage);
                                  setIsCopied(true);
                                  setTimeout(() => setIsCopied(false), 2000);
                                }
                              }}
                              className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200 transition-colors"
                            >
                              {isCopied ? '✓ Copied to clipboard' : 'Copy message'}
                            </button>
                          </div>
                          <div className="p-3 rounded-md bg-white dark:bg-[#0f0f12] border border-indigo-100 dark:border-indigo-900/50 text-gray-700 dark:text-gray-300 font-mono text-[11px] leading-relaxed">
                            {aiReasoning.suggestedCustomerMessage}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 py-2">AI intelligence advisory unavailable.</p>
                    )}
                  </div>

                  {/* 3. USER-AUTHORIZED ACTION RECORD */}
                  {actionState?.latestAction && (
                    <div className="bg-gray-50 dark:bg-[#18181b] p-5 rounded-lg border border-gray-200 dark:border-gray-800">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs uppercase tracking-wider font-semibold text-gray-700 dark:text-gray-300">
                          User-Authorized Action Record
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
                          {actionState.latestAction.status}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-400 mt-2">
                        <div>
                          <span className="font-medium text-gray-800 dark:text-gray-200">Action Type: </span>
                          {actionState.latestAction.type?.replace(/_/g, ' ')}
                        </div>
                        <div>
                          <span className="font-medium text-gray-800 dark:text-gray-200">Initiated At: </span>
                          {actionState.latestAction.approvedAt ? new Date(actionState.latestAction.approvedAt).toLocaleString() : 'N/A'}
                        </div>
                        <div className="col-span-2 mt-1">
                          <span className="font-medium text-gray-800 dark:text-gray-200">Audit Notes: </span>
                          {actionState.latestAction.notes || 'No notes recorded.'}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 4. EXECUTION RECORD & PROVIDER RESULT */}
                  {latestExecution && (
                    <div className="bg-gray-50 dark:bg-[#18181b] p-5 rounded-lg border border-indigo-200 dark:border-indigo-900/60 shadow-xs">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${latestExecution.status === 'SUCCEEDED' ? 'bg-emerald-500' : latestExecution.status === 'FAILED' ? 'bg-rose-500' : 'bg-blue-500 animate-ping'}`}></span>
                          <span className="text-xs uppercase tracking-wider font-semibold text-gray-900 dark:text-gray-100">
                            Execution Record & Provider Result
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${getExecutionBadgeColor(latestExecution.status)}`}>
                          {latestExecution.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs text-gray-600 dark:text-gray-400 mt-3">
                        <div>
                          <span className="font-medium text-gray-800 dark:text-gray-200">Provider: </span>
                          <span className="font-mono text-gray-900 dark:text-gray-100">{latestExecution.provider}</span>
                        </div>
                        <div>
                          <span className="font-medium text-gray-800 dark:text-gray-200">Attempts: </span>
                          <span>{latestExecution.attemptCount} of {latestExecution.maxAttempts}</span>
                        </div>
                        <div className="col-span-2">
                          <span className="font-medium text-gray-800 dark:text-gray-200">External Ref: </span>
                          <span className="font-mono text-gray-700 dark:text-gray-300">{latestExecution.externalReference || 'N/A'}</span>
                        </div>
                        {latestExecution.failureReason && (
                          <div className="col-span-2 text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 p-2.5 rounded border border-rose-200 dark:border-rose-900">
                            <span className="font-semibold">Failure Reason: </span>
                            {latestExecution.failureReason}
                          </div>
                        )}
                        <div className="col-span-2 flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-800 text-[11px] text-gray-500">
                          <span>Completed: {latestExecution.completedAt ? new Date(latestExecution.completedAt).toLocaleString() : 'Running...'}</span>
                          {latestExecution.status === 'FAILED' && latestExecution.attemptCount < latestExecution.maxAttempts && isPrivileged && (
                            <button
                              onClick={() => handleRetryExecution(latestExecution.id)}
                              disabled={isProcessing}
                              className="px-2.5 py-1 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-xs font-semibold rounded hover:bg-gray-800 transition-all disabled:opacity-50"
                            >
                              Retry Execution
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 5. DUNNING CADENCE & RECOVERY PORTAL LIFECYCLE */}
                  <div className="bg-gray-50 dark:bg-[#18181b] p-5 rounded-lg border border-purple-200 dark:border-purple-900/60 shadow-xs">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="p-1 rounded bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        </div>
                        <div>
                          <h5 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Automated Dunning Cadence & Recovery Portal</h5>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">Day 1 → Day 3 → Day 7 multi-channel notification loop</p>
                        </div>
                      </div>
                      {actionState?.dunningCadence ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
                          {actionState.dunningCadence.status}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                          Not Scheduled
                        </span>
                      )}
                    </div>

                    {/* Cadence Step Progression */}
                    <div className="grid grid-cols-3 gap-2 my-3 p-3 bg-white dark:bg-[#0f0f12] rounded-lg border border-purple-100 dark:border-purple-900/40 text-center">
                      <div className={`p-2 rounded ${actionState?.dunningCadence?.currentStep === 1 ? 'bg-purple-50 dark:bg-purple-950/60 font-bold text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800' : 'text-gray-400'}`}>
                        <p className="text-[10px] uppercase tracking-wider">Step 1</p>
                        <p className="text-xs mt-0.5">Day 1 (Initial)</p>
                      </div>
                      <div className={`p-2 rounded ${actionState?.dunningCadence?.currentStep === 2 ? 'bg-purple-50 dark:bg-purple-950/60 font-bold text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800' : 'text-gray-400'}`}>
                        <p className="text-[10px] uppercase tracking-wider">Step 2</p>
                        <p className="text-xs mt-0.5">Day 3 (+2d)</p>
                      </div>
                      <div className={`p-2 rounded ${actionState?.dunningCadence?.currentStep === 3 ? 'bg-purple-50 dark:bg-purple-950/60 font-bold text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800' : 'text-gray-400'}`}>
                        <p className="text-[10px] uppercase tracking-wider">Step 3</p>
                        <p className="text-xs mt-0.5">Day 7 (+4d)</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs text-gray-600 dark:text-gray-400 mt-2">
                      <div>
                        <span className="font-medium text-gray-800 dark:text-gray-200">Channel: </span>
                        <span>{actionState?.dunningCadence?.channel || 'EMAIL (Resend)'}</span>
                      </div>
                      <div>
                        <span className="font-medium text-gray-800 dark:text-gray-200">Portal Link Status: </span>
                        <span className={actionState?.hasActivePortal ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-gray-500'}>
                          {actionState?.hasActivePortal ? 'Active & Unexpired' : 'Not Generated / Inactive'}
                        </span>
                      </div>
                      {actionState?.dunningCadence?.scheduledAt && actionState.dunningCadence.status === 'SCHEDULED' && currentStatus !== 'RECOVERED' && currentStatus !== 'FAILED' && currentStatus !== 'DISMISSED' && (
                        <div className="col-span-2">
                          <span className="font-medium text-gray-800 dark:text-gray-200">Next Scheduled Run: </span>
                          <span className="font-mono text-gray-900 dark:text-gray-100">
                            {new Date(actionState.dunningCadence.scheduledAt).toLocaleString()}
                          </span>
                        </div>
                      )}
                      {actionState?.activeTokenExpiry && (
                        <div className="col-span-2">
                          <span className="font-medium text-gray-800 dark:text-gray-200">Active Token Expiry: </span>
                          <span className="font-mono text-gray-700 dark:text-gray-300">
                            {new Date(actionState.activeTokenExpiry).toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>

                    {!actionState?.dunningCadence && currentStatus !== 'RECOVERED' && currentStatus !== 'DISMISSED' && isPrivileged && (
                      <div className="mt-4 pt-3 border-t border-purple-100 dark:border-purple-900/40 flex justify-between items-center">
                        <span className="text-[11px] text-gray-500">Initialize Day 1/3/7 background cadence</span>
                        <button
                          type="button"
                          onClick={handleScheduleCadence}
                          disabled={isProcessing}
                          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50"
                        >
                          {isProcessing ? 'Scheduling...' : 'Start Dunning Cadence'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* CONFIRMATION MODAL FOR EXECUTION */}
            {showConfirmExecute && (
              <div className="px-6 py-4 bg-indigo-50 dark:bg-indigo-950/60 border-t border-indigo-200 dark:border-indigo-900/60 flex flex-col gap-3">
                <div className="text-xs text-indigo-900 dark:text-indigo-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-bold uppercase tracking-wider text-[11px]">Confirm Recovery Action Execution</p>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                      SIMULATION / AUDIT MODE
                    </span>
                  </div>
                  <div className="bg-white/90 dark:bg-black/40 p-3 rounded-lg border border-indigo-100 dark:border-indigo-900/50 space-y-1 font-mono text-[11px]">
                    <div><span className="font-semibold text-gray-700 dark:text-gray-300">Action:</span> {actionState?.latestAction?.type || recommendation?.recommendedAction || 'RETRY_PAYMENT'}</div>
                    <div><span className="font-semibold text-gray-700 dark:text-gray-300">Customer / Ref:</span> {selectedOpp.customerName}</div>
                    <div><span className="font-semibold text-gray-700 dark:text-gray-300">Amount:</span> ${(selectedOpp.amount).toLocaleString()}</div>
                    <div><span className="font-semibold text-gray-700 dark:text-gray-300">Provider:</span> {actionState?.latestAction?.channel || recommendation?.suggestedChannel || 'Simulation Audit Provider'}</div>
                    <div><span className="font-semibold text-gray-700 dark:text-gray-300">Expected Effect:</span> Dispatches recovery workflow safely to provider with idempotent tracking.</div>
                  </div>
                  <p className="text-[11px] font-semibold text-indigo-900 dark:text-indigo-100">
                    SIMULATION / AUDIT MODE: NO EXTERNAL ACTION WILL OCCUR. Provider behavior will be safely simulated and logged to the immutable audit trail.
                  </p>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setShowConfirmExecute(false)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleExecuteRecovery}
                    disabled={isProcessing}
                    className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm disabled:opacity-50"
                  >
                    {isProcessing ? 'Executing...' : 'Confirm & Execute'}
                  </button>
                </div>
              </div>
            )}

            <div className="px-6 py-5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-[#18181b] flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {!isPrivileged && (
                    <span className="text-amber-600 dark:text-amber-400 font-medium mr-2">
                      View-only access (MEMBER). Admin/Owner role required to execute actions.
                    </span>
                  )}
                  {currentStatus === 'DETECTED' && 'Review recommendation and initiate recovery action.'}
                  {currentStatus === 'IN_PROGRESS' && !latestExecution && 'Action authorized. Ready to execute recovery workflow.'}
                  {currentStatus === 'IN_PROGRESS' && latestExecution?.status === 'SUCCEEDED' && 'Execution succeeded. Confirm recovery outcome once funds settle.'}
                  {currentStatus === 'IN_PROGRESS' && latestExecution?.status === 'FAILED' && 'Execution attempt failed. Review failure or retry.'}
                  {currentStatus === 'RECOVERED' && 'Revenue confirmed recovered.'}
                  {currentStatus === 'FAILED' && 'Recovery attempt marked failed.'}
                  {currentStatus === 'DISMISSED' && 'Opportunity dismissed.'}
                </p>
              </div>

              <div className="flex gap-3 items-center">
                {/* State: Action is PENDING (Awaiting Manual Approval) */}
                {actionState?.latestAction?.status === 'PENDING' && (
                  <>
                    <button 
                      onClick={handleRejectPendingAction}
                      disabled={isProcessing || !isPrivileged}
                      title={!isPrivileged ? 'Admin or Owner role required' : undefined}
                      className="px-4 py-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-400 text-sm font-medium rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Reject
                    </button>
                    <button 
                      onClick={handleApprovePendingAction}
                      disabled={isProcessing || !isPrivileged}
                      title={!isPrivileged ? 'Admin or Owner role required' : undefined}
                      className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-indigo-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isProcessing ? 'Approving...' : 'Approve & Execute'}
                    </button>
                  </>
                )}

                {/* State: DETECTED -> Take Action or Dismiss */}
                {currentStatus === 'DETECTED' && actionState?.latestAction?.status !== 'PENDING' && (
                  <>
                    <button 
                      onClick={handleDismiss}
                      disabled={isProcessing || !isPrivileged}
                      title={!isPrivileged ? 'Admin or Owner role required' : undefined}
                      className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Dismiss
                    </button>
                    <button 
                      onClick={handleTakeAction}
                      disabled={isProcessing || !isPrivileged}
                      title={!isPrivileged ? 'Admin or Owner role required' : undefined}
                      className="px-5 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-medium rounded-lg shadow-sm hover:bg-gray-800 dark:hover:bg-gray-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isProcessing ? 'Processing...' : 'Take Action'}
                    </button>
                  </>
                )}

                {/* State: IN_PROGRESS -> Execute Recovery or Finalize Outcome */}
                {currentStatus === 'IN_PROGRESS' && (
                  <>
                    {!latestExecution && !showConfirmExecute && (
                      <button
                        onClick={() => setShowConfirmExecute(true)}
                        disabled={isProcessing || !isPrivileged}
                        title={!isPrivileged ? 'Admin or Owner role required' : undefined}
                        className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-indigo-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Execute Action
                      </button>
                    )}
                    <button 
                      onClick={handleMarkFailed}
                      disabled={isProcessing || !isPrivileged}
                      title={!isPrivileged ? 'Admin or Owner role required' : undefined}
                      className="px-4 py-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-400 text-sm font-medium rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Mark Failed
                    </button>
                    <button 
                      onClick={handleMarkRecovered}
                      disabled={isProcessing || !isPrivileged}
                      title={!isPrivileged ? 'Admin or Owner role required' : undefined}
                      className="px-5 py-2 bg-emerald-600 dark:bg-emerald-500 text-white text-sm font-medium rounded-lg shadow-sm hover:bg-emerald-700 dark:hover:bg-emerald-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isProcessing ? 'Processing...' : 'Mark Recovered'}
                    </button>
                  </>
                )}

                {/* Terminal States */}
                {(currentStatus === 'RECOVERED' || currentStatus === 'FAILED' || currentStatus === 'DISMISSED') && (
                  <span className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs font-semibold rounded-lg uppercase tracking-wider">
                    Resolved ({currentStatus})
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
