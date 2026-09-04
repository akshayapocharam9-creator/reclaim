'use client';
import React from 'react';
import { useAppContext } from '../context/AppContext';
import AgentPanel from '../components/AgentPanel';

export default function AgentPage() {
  const { activities, decision, settings } = useAppContext();

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Agent Status</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">View real-time intelligence monitoring and decision making.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden p-8">
            <div className="flex items-center gap-4 mb-6">
              <div className="relative flex h-3 w-3">
                {settings.agentActive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                <span className={`relative inline-flex rounded-full h-3 w-3 ${settings.agentActive ? 'bg-emerald-500' : 'bg-gray-400'}`}></span>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {settings.agentActive ? 'Monitoring active' : 'Agent paused'}
              </h2>
            </div>
            
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-w-2xl">
              RECLAIM is actively analyzing revenue signals across connected systems. Current pipeline indicates a focus on {decision ? 'immediate high-value interventions' : 'ongoing background monitoring'}.
            </p>
          </div>

          {/* Autonomous Architecture & Safety Guardrails */}
          <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden p-6 md:p-8">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
              Autonomous Architecture & Safety Guardrails
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-gray-50 dark:bg-[#18181b] border border-gray-100 dark:border-gray-800">
                <p className="text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 mb-1">Deterministic Authority</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                  Execution limits, cooldowns, and status transitions are governed strictly by deterministic PostgreSQL policies.
                </p>
              </div>

              <div className="p-4 rounded-lg bg-gray-50 dark:bg-[#18181b] border border-gray-100 dark:border-gray-800">
                <p className="text-xs font-bold uppercase tracking-wider text-purple-700 dark:text-purple-400 mb-1">AI Advisory Decoupling</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                  AI synthesizes risk explanations and drafts customer outreach. AI never executes payment transactions directly.
                </p>
              </div>

              <div className="p-4 rounded-lg bg-gray-50 dark:bg-[#18181b] border border-gray-100 dark:border-gray-800">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1">Audit & Idempotency</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                  Every recovery attempt is bound to cryptographic idempotency keys, safe audit simulation, and dead-letter queue protections.
                </p>
              </div>
            </div>
          </div>

          {decision && (
            <div className="bg-white dark:bg-[#09090b] shadow-sm border border-blue-200 dark:border-blue-900/50 rounded-xl overflow-hidden">
              <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 bg-blue-50/50 dark:bg-blue-950/20">
                <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 uppercase tracking-wider">Current Priority Focus</h3>
              </div>
              <div className="p-6 md:p-8">
                <h4 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">{decision.opportunity.customerName}</h4>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{decision.opportunity.analysis.problem}</p>
                
                <div className="space-y-4">
                  <div>
                    <span className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Agent Reasoning</span>
                    <p className="text-sm text-gray-700 dark:text-gray-300">{decision.explanation}</p>
                  </div>
                  <div>
                    <span className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Recommended Action</span>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-200">{decision.opportunity.analysis.recommendedAction}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          {/* Reuse the existing AgentPanel component for consistency */}
          <AgentPanel activities={activities} decision={null} isActive={settings.agentActive} />
        </div>
      </div>
    </div>
  );
}
