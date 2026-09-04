/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import MetricCard from './components/MetricCard';
import OpportunityList from './components/OpportunityList';
import RecoveryChart from './components/RecoveryChart';
import { useAppContext } from './context/AppContext';
import { useAuth } from './context/AuthContext';

export default function Home() {
  const { role } = useAuth();
  const isPrivileged = role === 'OWNER' || role === 'ADMIN';

  const {
    opportunities,
    activities,
    decision,
    approveOpportunity,
    dismissOpportunity,
    settings,
    analytics,
    auditEvents,
    refreshData
  } = useAppContext();
  
  const [dateRange, setDateRange] = useState<'7D' | '30D' | '90D'>('30D');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [policy, setPolicy] = useState<any>(null);
  const [isTogglingPolicy, setIsTogglingPolicy] = useState(false);
  const [providerHealth, setProviderHealth] = useState<any[]>([]);
  const [deadLetterCount, setDeadLetterCount] = useState<number>(0);
  const [isTriggeringWorker, setIsTriggeringWorker] = useState(false);
  const [workerMessage, setWorkerMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/revenue/policies')
      .then(res => res.json())
      .then(data => {
        if (data.activePolicy) {
          setPolicy(data.activePolicy);
        }
      })
      .catch(err => console.error('Error fetching recovery policy:', err));

    fetch('/api/revenue/providers/health')
      .then(res => res.json())
      .then(data => {
        if (data.providers) setProviderHealth(data.providers);
      })
      .catch(() => {});

    fetch('/api/revenue/executions/dead-letter')
      .then(res => res.json())
      .then(data => {
        if (typeof data.count === 'number') setDeadLetterCount(data.count);
      })
      .catch(() => {});
  }, []);

  const handleTriggerWorker = async () => {
    setIsTriggeringWorker(true);
    setWorkerMessage(null);
    try {
      const res = await fetch('/api/cron/worker', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setWorkerMessage(`Worker processed: ${data.claimedCount} claimed, ${data.succeededCount} succeeded, ${data.staleRecoveredCount} stale recovered`);
        if (refreshData) await refreshData();
        const dlRes = await fetch('/api/revenue/executions/dead-letter');
        const dlData = await dlRes.json();
        if (typeof dlData.count === 'number') setDeadLetterCount(dlData.count);
      } else {
        setWorkerMessage(`Worker error: ${data.error || 'Failed'}`);
      }
    } catch (err: any) {
      setWorkerMessage(`Worker run failed: ${err.message}`);
    } finally {
      setIsTriggeringWorker(false);
    }
  };

  const handleToggleKillSwitch = async () => {
    if (!policy || !isPrivileged) return;
    setIsTogglingPolicy(true);
    try {
      const nextState = !policy.autoExecutionEnabled;
      const res = await fetch('/api/revenue/policies/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextState })
      });
      if (res.ok) {
        const data = await res.json();
        setPolicy((prev: any) => ({ ...prev, autoExecutionEnabled: data.autoExecutionEnabled }));
        if (refreshData) await refreshData();
      }
    } catch (err) {
      console.error('Error toggling automation kill switch:', err);
    } finally {
      setIsTogglingPolicy(false);
    }
  };

  // Compute metrics from database analytics where available, fallback to opportunities list
  const pendingOpps = opportunities.filter(o => o.status === 'queued_for_recovery' || (o.status as string) === 'detected' || (o.status as string) === 'pending');
  const filteredPending = pendingOpps.filter(o => priorityFilter === 'all' || o.priority === priorityFilter);
  
  const totalAtRisk = analytics?.totals?.totalAmountAtRiskMinor != null
    ? Math.round(analytics.totals.totalAmountAtRiskMinor / 100)
    : filteredPending.reduce((sum, opp) => sum + opp.amount, 0);

  const totalRecovered = analytics?.totals?.totalRecoveredRevenueMinor != null
    ? Math.round(analytics.totals.totalRecoveredRevenueMinor / 100)
    : opportunities.filter(o => o.status === 'recovered').reduce((sum, opp) => sum + opp.amount, 0);

  const approvedCount = opportunities.filter(o => o.status === 'queued_for_recovery' || o.status === 'in_progress').length;

  const recoveryRate = analytics?.rates?.recoveryRate != null
    ? analytics.rates.recoveryRate
    : (totalAtRisk + totalRecovered > 0 ? Math.round((totalRecovered / (totalAtRisk + totalRecovered)) * 100) : 0);

  const totalExecutions = analytics?.executions?.totalExecutions || 0;
  const successfulExecutions = analytics?.executions?.successfulExecutions || 0;
  const executionSuccessRate = analytics?.executions?.executionSuccessRate != null
    ? analytics.executions.executionSuccessRate
    : 100;

  // Visual Pipeline Data
  const pipeline = {
    detected: opportunities.length,
    analyzed: opportunities.filter(o => o.status !== 'dismissed').length,
    recommended: pendingOpps.length,
    approved: approvedCount,
    recovered: opportunities.filter(o => o.status === 'recovered').length,
  };

  // Real database time series data if available, otherwise deterministic buckets
  const chartData = useMemo(() => {
    if (analytics?.timeSeries && analytics.timeSeries.length > 0) {
      return analytics.timeSeries;
    }

    if (dateRange === '7D') {
      return Array.from({length: 7}).map((_, i) => ({
        label: `Day ${i+1}`,
        atRisk: (i * 400) % 3000 + 1000,
        recovered: (i * 200) % 2000 + 500
      }));
    } else if (dateRange === '30D') {
      return Array.from({length: 4}).map((_, i) => ({
        label: `Week ${i+1}`,
        atRisk: (i * 3000) % 15000 + 5000,
        recovered: (i * 1500) % 10000 + 2000
      }));
    } else {
      return Array.from({length: 6}).map((_, i) => ({
        label: `Month ${i+1}`,
        atRisk: (i * 12000) % 60000 + 20000,
        recovered: (i * 8000) % 40000 + 10000
      }));
    }
  }, [dateRange, analytics?.timeSeries]);

  const activeDunningCount = opportunities.filter(o => o.dunningStep && o.dunningStep > 0 && o.status !== 'recovered' && o.status !== 'dismissed').length;
  const activeIntegrations = useAppContext().integrations.filter(i => i.status === 'connected').length;

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 pb-12">
      
      {/* HEADER: REVENUE HEALTH */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Revenue Intelligence & Recovery</h1>
            <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full border ${settings.agentActive ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-100 dark:border-emerald-900/50' : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
              <div className="relative flex h-1.5 w-1.5">
                {settings.agentActive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${settings.agentActive ? 'bg-emerald-500' : 'bg-gray-400'}`}></span>
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${settings.agentActive ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}`}>
                {settings.agentActive ? 'Monitoring Active' : 'Agent Paused'}
              </span>
            </div>

            {/* Automation Policy & Kill Switch Control */}
            {policy && (
              <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full border ${
                policy.autoExecutionEnabled 
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300'
                  : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/50 text-rose-800 dark:text-rose-300'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${policy.autoExecutionEnabled ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  Automation: {policy.autoExecutionEnabled ? 'Active' : 'Kill Switch (Paused)'}
                </span>
                {isPrivileged && (
                  <button
                    onClick={handleToggleKillSwitch}
                    disabled={isTogglingPolicy}
                    title={policy.autoExecutionEnabled ? 'Click to trigger kill switch and pause automatic execution' : 'Click to resume automatic recovery execution'}
                    className={`ml-1 text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded border transition-all ${
                      policy.autoExecutionEnabled
                        ? 'bg-rose-100 hover:bg-rose-200 border-rose-300 text-rose-700'
                        : 'bg-emerald-100 hover:bg-emerald-200 border-emerald-300 text-emerald-700'
                    }`}
                  >
                    {isTogglingPolicy ? '...' : policy.autoExecutionEnabled ? 'Kill Switch' : 'Resume'}
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900/50 text-indigo-700 dark:text-indigo-300">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
              <span className="text-[10px] font-bold uppercase tracking-wider">
                Execution Mode: AUDIT
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800">
              <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                {activeIntegrations} Data Source{activeIntegrations !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Production-grade recovery execution. Automated risk detection, deterministic recommendations, and auditable action execution.</p>
        </div>
        
        <div className="flex items-center bg-gray-100 dark:bg-[#18181b] p-1 rounded-lg border border-gray-200 dark:border-gray-800">
          {(['7D', '30D', '90D'] as const).map(range => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${dateRange === range ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        
        {/* LEFT COLUMN: VISUALIZATIONS & PIPELINE */}
        <div className="xl:col-span-2 space-y-8">
          
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <MetricCard title="Revenue At Risk" value={`$${totalAtRisk.toLocaleString()}`} variant="primary" />
            <MetricCard title="Recovered Revenue" value={`$${totalRecovered.toLocaleString()}`} />
            <MetricCard title="Active Recoveries" value={approvedCount.toString()} />
            <MetricCard title="Active Dunning" value={activeDunningCount.toString()} />
            <MetricCard title="Recovery Rate" value={`${recoveryRate}%`} />
          </div>

          {/* Real Operational Execution Control Plane Strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 bg-white dark:bg-[#09090b] p-4 rounded-xl border border-gray-200 dark:border-gray-800 shadow-xs">
            <div className="border-r border-gray-100 dark:border-gray-800 pr-3">
              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Executions</span>
              <p className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">{totalExecutions}</p>
            </div>
            <div className="border-r border-gray-100 dark:border-gray-800 pr-3">
              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Succeeded / Failed</span>
              <p className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">
                <span className="text-emerald-600 dark:text-emerald-400">{successfulExecutions}</span>
                <span className="text-gray-400 mx-1">/</span>
                <span className="text-rose-600 dark:text-rose-400">{analytics?.executions?.failedExecutions || 0}</span>
              </p>
            </div>
            <div className="border-r border-gray-100 dark:border-gray-800 pr-3">
              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Active Queue</span>
              <p className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">
                <span className="text-blue-600 dark:text-blue-400">{analytics?.executions?.runningExecutions || 0} run</span>
                <span className="text-gray-400 mx-1">·</span>
                <span className="text-amber-600 dark:text-amber-400">{analytics?.executions?.queuedExecutions || 0} queued</span>
              </p>
            </div>
            <div className="border-r border-gray-100 dark:border-gray-800 pr-3">
              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Avg Latency</span>
              <p className="text-xl font-bold text-gray-900 dark:text-white mt-0.5 font-mono">
                {analytics?.executions?.averageExecutionLatencyMs ? `${analytics.executions.averageExecutionLatencyMs}ms` : 'Instant'}
              </p>
            </div>
            <div>
              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Success Rate</span>
              <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">{executionSuccessRate}%</p>
            </div>
          </div>

          {/* Production Operations, Provider Health & Worker Strip */}
          <div className="bg-white dark:bg-[#09090b] p-4 rounded-xl border border-gray-200 dark:border-gray-800 shadow-xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">Providers:</span>
                {providerHealth.length > 0 ? (
                  providerHealth.map(p => (
                    <div key={p.providerName} className="flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        p.status === 'HEALTHY' ? 'bg-emerald-500' :
                        p.status === 'DEGRADED' ? 'bg-amber-500' :
                        p.status === 'DOWN' ? 'bg-rose-500' : 'bg-gray-400'
                      }`} />
                      <span className="font-mono text-[11px] text-gray-700 dark:text-gray-300">
                        {p.providerName.replace('_PROVIDER', '')}
                      </span>
                      <span className="text-[10px] text-gray-400 uppercase">({p.status})</span>
                    </div>
                  ))
                ) : (
                  <span className="text-xs text-gray-400">Loading provider health...</span>
                )}

                {deadLetterCount > 0 && (
                  <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                    <span>Review Queue: {deadLetterCount}</span>
                  </div>
                )}
              </div>

              {isPrivileged && (
                <div className="flex items-center gap-3">
                  {workerMessage && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      {workerMessage}
                    </span>
                  )}
                  <button
                    onClick={handleTriggerWorker}
                    disabled={isTriggeringWorker}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-900 text-white dark:bg-white dark:text-gray-900 hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
                  >
                    {isTriggeringWorker ? (
                      <>
                        <svg className="animate-spin -ml-0.5 mr-1 h-3 w-3 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Processing Queue...
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        Run Worker Batch
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="h-72">
            <RecoveryChart data={chartData} dateRange={dateRange} />
          </div>

          <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden p-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight mb-6">Recovery Pipeline</h2>
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 relative">
              <div className="hidden md:block absolute top-1/2 left-0 w-full h-[2px] bg-gray-100 dark:bg-gray-800 -translate-y-1/2 z-0"></div>
              
              {[
                { label: 'Detected', count: pipeline.detected, color: 'text-gray-500' },
                { label: 'Analyzed', count: pipeline.analyzed, color: 'text-blue-500' },
                { label: 'Recommended', count: pipeline.recommended, color: 'text-indigo-500' },
                { label: 'Approved', count: pipeline.approved, color: 'text-purple-500' },
                { label: 'Recovered', count: pipeline.recovered, color: 'text-emerald-500' }
              ].map((stage, idx) => (
                <div key={idx} className="relative z-10 flex flex-col items-center bg-white dark:bg-[#09090b] px-4 py-2 border border-gray-100 dark:border-gray-800 rounded-lg shadow-sm w-full md:w-32">
                  <span className={`text-2xl font-bold ${stage.color}`}>{stage.count}</span>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-1">{stage.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Priority Opportunities & Execution</h2>
              <select 
                value={priorityFilter}
                onChange={e => setPriorityFilter(e.target.value)}
                className="px-3 py-1.5 bg-white dark:bg-[#18181b] border border-gray-200 dark:border-gray-800 rounded-md text-xs font-medium focus:outline-none focus:ring-2 focus:ring-gray-900"
              >
                <option value="all">All Priorities</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
              </select>
            </div>
            <OpportunityList 
              opportunities={filteredPending} 
              onApprove={approveOpportunity} 
              onDismiss={dismissOpportunity}
            />
          </div>

        </div>

        {/* RIGHT COLUMN: AGENT COMMAND & TIMELINE */}
        <div className="xl:col-span-1 space-y-8">
          
          <div className="bg-gray-900 dark:bg-[#18181b] rounded-xl overflow-hidden shadow-lg border border-gray-800 dark:border-gray-800 text-white flex flex-col">
            <div className="p-6 border-b border-gray-800 bg-black/20">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-400 mb-1">Agent Command Area</h2>
              {settings.agentActive ? (
                <p className="text-xl font-medium text-white">Synthesizing Recovery Path</p>
              ) : (
                <p className="text-xl font-medium text-gray-500">Agent Paused</p>
              )}
            </div>

            <div className="p-6 flex-1">
              {!settings.agentActive ? (
                <div className="text-center py-8">
                  <svg className="w-12 h-12 text-gray-700 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <p className="text-sm text-gray-400">Monitoring is disabled in Settings.</p>
                </div>
              ) : decision ? (
                <div className="space-y-6">
                  <div>
                    <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2">Current Decision</p>
                    <p className="text-lg font-medium leading-snug">Prioritize {decision.opportunity.customerName}</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Why</p>
                    <p className="text-sm text-gray-300 mb-4">{decision.explanation}</p>
                    
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Recommended Action</p>
                    <p className="text-sm text-white font-medium">{decision.opportunity.analysis.recommendedAction}</p>
                  </div>
                  {settings.approvalMode === 'agent' ? (
                    <div className="bg-emerald-900/40 border border-emerald-800 text-emerald-400 text-sm px-4 py-3 rounded-lg flex items-start gap-3">
                      <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                      <p>Agent is authorized to queue actions automatically based on your Settings.</p>
                    </div>
                  ) : (
                    <button 
                      onClick={() => approveOpportunity(decision.opportunity.id)}
                      className="w-full py-3 bg-white text-gray-900 font-bold rounded-lg hover:bg-gray-100 transition-colors shadow-[0_0_15px_rgba(255,255,255,0.1)]"
                    >
                      Approve Action
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-400">No priority opportunities currently detected.</p>
                </div>
              )}
            </div>
          </div>

          {/* REAL AUDIT ACTIVITY TIMELINE */}
          <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Audit & Activity Timeline</h2>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-100 dark:border-indigo-900/50">
                Immutable Log
              </span>
            </div>

            {auditEvents && auditEvents.length > 0 ? (
              <div className="space-y-6">
                {auditEvents.slice(0, 6).map((event: any, idx: number) => {
                  const isSuccess = event.eventType.includes('SUCCESS') || event.eventType.includes('RECOVERED');
                  const isFailure = event.eventType.includes('FAIL');
                  const isAction = event.eventType.includes('ACTION') || event.eventType.includes('EXECUTION');

                  return (
                    <div key={event.id} className="flex gap-4 relative">
                      {idx !== Math.min(auditEvents.length, 6) - 1 && (
                        <div className="absolute top-6 left-2 w-[1px] h-full bg-gray-200 dark:bg-gray-800 -z-10"></div>
                      )}
                      <div className="mt-1 shrink-0">
                        <div className={`w-4 h-4 rounded-full border-2 border-white dark:border-[#09090b] z-10 ${
                          isSuccess ? 'bg-emerald-500' :
                          isFailure ? 'bg-rose-500' :
                          isAction ? 'bg-blue-500' : 'bg-gray-400'
                        }`}></div>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-900 dark:text-gray-200 font-mono">
                            {event.eventType.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">
                            {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {event.actorEmail ? `Actor: ${event.actorEmail}` : 'System Agent'}
                          {event.entityType ? ` · ${event.entityType}` : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : activities.length > 0 ? (
              <div className="space-y-6">
                {activities.slice(0, 5).map((activity, idx) => (
                  <div key={activity.id} className="flex gap-4 relative">
                    {idx !== activities.slice(0, 5).length - 1 && (
                      <div className="absolute top-6 left-2 w-[1px] h-full bg-gray-200 dark:bg-gray-800 -z-10"></div>
                    )}
                    <div className="mt-1 shrink-0">
                      <div className={`w-4 h-4 rounded-full border-2 border-white dark:border-[#09090b] z-10 ${
                        activity.type === 'action' ? 'bg-blue-500' :
                        activity.type === 'alert' ? 'bg-rose-500' :
                        activity.type === 'success' ? 'bg-emerald-500' : 'bg-gray-400'
                      }`}></div>
                    </div>
                    <div>
                      <p className="text-sm text-gray-900 dark:text-gray-200 font-medium">{activity.message}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">{activity.timestamp}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No recent activity recorded.</p>
            )}
          </div>

        </div>

      </div>
    </div>
  );
}
