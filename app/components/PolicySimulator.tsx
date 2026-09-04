/* eslint-disable react-hooks/set-state-in-effect */
'use client';
import React, { useState, useEffect, useTransition } from 'react';

interface PolicySimulationData {
  amountMinor: number;
  amountINR: number;
  thresholdMinor: number;
  thresholdINR: number;
  decision: 'AUTO_EXECUTE' | 'APPROVAL_REQUIRED' | 'BLOCKED' | 'SKIPPED';
  reasonCode: string;
  reason: string;
  requiresApproval: boolean;
  policyName?: string;
  policyVersion?: number;
  evaluatedAt: string;
}

const PRESET_AMOUNTS = [5000, 7500, 10000, 20000, 100000];

export default function PolicySimulator() {
  const [amountInput, setAmountInput] = useState<string>('7500');
  const [simulation, setSimulation] = useState<PolicySimulationData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const fetchSimulation = async (amount: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/revenue/policies/simulate?amount=${amount}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to simulate policy');
      }
      const data: PolicySimulationData = await res.json();
      startTransition(() => {
        setSimulation(data);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Simulation failed';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Initial evaluation with demo default ₹7,500
    fetchSimulation(7500);
  }, []);

  const handlePresetClick = (preset: number) => {
    setAmountInput(preset.toString());
    fetchSimulation(preset);
  };

  const handleInputChange = (val: string) => {
    setAmountInput(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed >= 0) {
      fetchSimulation(parsed);
    }
  };

  const getDecisionBadge = (decision: string) => {
    switch (decision) {
      case 'AUTO_EXECUTE':
        return (
          <span className="px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            AUTO EXECUTE
          </span>
        );
      case 'APPROVAL_REQUIRED':
        return (
          <span className="px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
            APPROVAL REQUIRED
          </span>
        );
      case 'BLOCKED':
        return (
          <span className="px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
            BLOCKED
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700">
            {decision}
          </span>
        );
    }
  };

  return (
    <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/60">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white">
              POLICY SIMULATOR
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Test how RECLAIM’s deterministic policy governs different recovery amounts.
            </p>
          </div>
        </div>

        <span className="inline-flex items-center text-[11px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-[#18181b] px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-800 self-start sm:self-auto">
          Deterministic Engine • No Live Actions
        </span>
      </div>

      {/* Input & Presets */}
      <div className="space-y-4 pt-2 border-t border-gray-100 dark:border-gray-800">
        <div>
          <label htmlFor="sim-amount" className="block text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-2">
            Simulate Transaction / Recovery Amount (INR)
          </label>
          <div className="relative rounded-lg shadow-xs max-w-sm">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <span className="text-gray-500 dark:text-gray-400 text-sm font-semibold">₹</span>
            </div>
            <input
              id="sim-amount"
              type="number"
              min="0"
              step="500"
              value={amountInput}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder="Enter amount..."
              className="block w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#18181b] pl-8 pr-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
            />
          </div>
        </div>

        {/* Preset Buttons */}
        <div>
          <span className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
            Quick Preset Evaluations:
          </span>
          <div className="flex flex-wrap gap-2">
            {PRESET_AMOUNTS.map((preset) => {
              const isSelected = parseFloat(amountInput) === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handlePresetClick(preset)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all font-mono ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-gray-100 dark:bg-[#18181b] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-800'
                  }`}
                >
                  ₹{preset.toLocaleString('en-IN')}
                </button>
              );
            })}
          </div>
        </div>

        {/* Simulation Output Result Card */}
        {error && (
          <div className="p-3.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        {simulation && !error && (
          <div className="mt-4 p-5 rounded-lg bg-gray-50 dark:bg-[#18181b] border border-gray-200 dark:border-gray-800 space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pb-3 border-b border-gray-200 dark:border-gray-800">
              <div>
                <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                  Amount Evaluated
                </p>
                <p className="text-lg font-bold text-gray-900 dark:text-white font-mono">
                  ₹{simulation.amountINR.toLocaleString('en-IN')}
                </p>
              </div>

              <div>
                <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                  Automatic Execution Threshold
                </p>
                <p className="text-lg font-bold text-gray-900 dark:text-white font-mono">
                  ₹{simulation.thresholdINR.toLocaleString('en-IN')}
                </p>
              </div>

              <div>
                <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                  Policy Decision
                </p>
                <div className="mt-0.5">
                  {getDecisionBadge(simulation.decision)}
                </div>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                Decision Reason
              </p>
              <p className="text-xs text-gray-700 dark:text-gray-300 font-medium leading-relaxed">
                {simulation.reason}
              </p>
              <p className="text-[10px] text-gray-400 font-mono mt-1">
                Code: {simulation.reasonCode} • Requires Operator Approval: {simulation.requiresApproval ? 'Yes' : 'No'}
              </p>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="py-2 text-center text-xs text-gray-400 animate-pulse">
            Evaluating deterministic policy...
          </div>
        )}

        {/* Safety Disclaimer */}
        <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
          <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-blue-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <span>Simulation only — no payment, recovery action, or database record is executed.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
