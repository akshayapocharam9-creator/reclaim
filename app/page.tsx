'use client';

import React, { useState, useMemo } from 'react';
import MetricCard from './components/MetricCard';
import OpportunityList from './components/OpportunityList';
import RecoveryChart from './components/RecoveryChart';
import { useAppContext } from './context/AppContext';

export default function Home() {
  const { opportunities, activities, decision, approveOpportunity, dismissOpportunity, settings } = useAppContext();
  
  const [dateRange, setDateRange] = useState<'7D' | '30D' | '90D'>('30D');
  const [priorityFilter, setPriorityFilter] = useState('all');

  // Compute metrics
  const pendingOpps = opportunities.filter(o => o.status === 'pending');
  const filteredPending = pendingOpps.filter(o => priorityFilter === 'all' || o.priority === priorityFilter);
  
  const totalAtRisk = filteredPending.reduce((sum, opp) => sum + opp.amount, 0);
  const totalRecovered = opportunities.filter(o => o.status === 'recovered').reduce((sum, opp) => sum + opp.amount, 0);
  const approvedCount = opportunities.filter(o => o.status === 'queued_for_recovery' || o.status === 'in_progress').length;

  const recoveryRate = totalAtRisk + totalRecovered > 0 ? Math.round((totalRecovered / (totalAtRisk + totalRecovered)) * 100) : 0;

  // Visual Pipeline Data
  const pipeline = {
    detected: opportunities.length,
    analyzed: opportunities.filter(o => o.status !== 'dismissed').length,
    recommended: pendingOpps.length,
    approved: approvedCount,
    recovered: opportunities.filter(o => o.status === 'recovered').length,
  };

  // Generate deterministic chart data based on range
  const chartData = useMemo(() => {
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
  }, [dateRange]);

  const activeIntegrations = useAppContext().integrations.filter(i => i.status === 'connected').length;

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 pb-12">
      
      {/* HEADER: REVENUE HEALTH */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Revenue Intelligence</h1>
            <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full border ${settings.agentActive ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-100 dark:border-emerald-900/50' : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
              <div className="relative flex h-1.5 w-1.5">
                {settings.agentActive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${settings.agentActive ? 'bg-emerald-500' : 'bg-gray-400'}`}></span>
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${settings.agentActive ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}`}>
                {settings.agentActive ? 'Monitoring Active' : 'Agent Paused'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800">
              <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                {activeIntegrations} Data Source{activeIntegrations !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Recover what would otherwise be lost. Continuous analysis of payment and retention signals.</p>
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
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard title="Revenue At Risk" value={`$${totalAtRisk.toLocaleString()}`} variant="primary" />
            <MetricCard title="Recovered Revenue" value={`$${totalRecovered.toLocaleString()}`} />
            <MetricCard title="Active Recoveries" value={approvedCount.toString()} />
            <MetricCard title="Recovery Rate" value={`${recoveryRate}%`} />
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
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Priority Opportunities</h2>
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
                      <p>Agent is authorized to execute this automatically based on your Settings.</p>
                    </div>
                  ) : (
                    <button 
                      onClick={() => approveOpportunity(decision.opportunity.id)}
                      className="w-full py-3 bg-white text-gray-900 font-bold rounded-lg hover:bg-gray-100 transition-colors shadow-[0_0_15px_rgba(255,255,255,0.1)]"
                    >
                      Approve Execution
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

          <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl p-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight mb-6">Activity Timeline</h2>
            {activities.length === 0 ? (
              <p className="text-sm text-gray-500">No recent activity.</p>
            ) : (
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
            )}
          </div>

        </div>

      </div>
    </div>
  );
}
