/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export default function SettingsPage() {
  const { role } = useAuth();
  const isPrivileged = role === 'OWNER' || role === 'ADMIN';

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [policyId, setPolicyId] = useState<string>('');
  const [policyVersion, setPolicyVersion] = useState<number>(1);
  const [autoExecutionEnabled, setAutoExecutionEnabled] = useState<boolean>(true);
  const [maxAmountINR, setMaxAmountINR] = useState<number>(10000);
  const [minAmountINR, setMinAmountINR] = useState<number>(0);
  const [cooldownMinutes, setCooldownMinutes] = useState<number>(60);
  const [maxAttempts, setMaxAttempts] = useState<number>(3);
  const [allowedPriorities, setAllowedPriorities] = useState<string[]>([
    'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
  ]);
  const [allowedActions, setAllowedActions] = useState<string[]>([
    'RETRY_PAYMENT',
    'SEND_PAYMENT_REMINDER',
    'ESCALATE',
    'CONTACT_CUSTOMER',
    'RECOVER_CHECKOUT',
    'RETRY_SUBSCRIPTION'
  ]);

  useEffect(() => {
    let active = true;

    async function loadPolicies() {
      try {
        const res = await fetch('/api/revenue/policies');
        if (!res.ok) {
          throw new Error('Failed to load recovery policies');
        }
        const data = await res.json();
        if (!active) return;
        const p = data.activePolicy;
        if (p) {
          setPolicyId(p.id);
          setPolicyVersion(p.version || 1);
          setAutoExecutionEnabled(Boolean(p.autoExecutionEnabled));
          setMaxAmountINR(Math.round((p.maxAmountMinor || 1000000) / 100));
          setMinAmountINR(Math.round((p.minAmountMinor || 0) / 100));
          setCooldownMinutes(Math.round((p.cooldownSeconds || 3600) / 60));
          setMaxAttempts(p.maxAttempts || 3);
          if (Array.isArray(p.allowedPriorities)) setAllowedPriorities(p.allowedPriorities);
          if (Array.isArray(p.allowedActions)) setAllowedActions(p.allowedActions);
        }
      } catch (err: any) {
        if (active) {
          setErrorMessage(err.message || 'Error loading settings');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    loadPolicies();

    return () => {
      active = false;
    };
  }, []);

  const resetPolicies = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/revenue/policies');
      if (!res.ok) {
        throw new Error('Failed to load recovery policies');
      }
      const data = await res.json();
      const p = data.activePolicy;
      if (p) {
        setPolicyId(p.id);
        setPolicyVersion(p.version || 1);
        setAutoExecutionEnabled(Boolean(p.autoExecutionEnabled));
        setMaxAmountINR(Math.round((p.maxAmountMinor || 1000000) / 100));
        setMinAmountINR(Math.round((p.minAmountMinor || 0) / 100));
        setCooldownMinutes(Math.round((p.cooldownSeconds || 3600) / 60));
        setMaxAttempts(p.maxAttempts || 3);
        if (Array.isArray(p.allowedPriorities)) setAllowedPriorities(p.allowedPriorities);
        if (Array.isArray(p.allowedActions)) setAllowedActions(p.allowedActions);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error loading settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!isPrivileged) return;
    setIsSaving(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const payload = {
        policyId,
        autoExecutionEnabled,
        maxAmountMinor: Math.max(0, maxAmountINR * 100),
        minAmountMinor: Math.max(0, minAmountINR * 100),
        cooldownSeconds: Math.max(60, cooldownMinutes * 60),
        maxAttempts: Math.max(1, Math.min(10, maxAttempts)),
        allowedPriorities,
        allowedActions
      };

      const res = await fetch('/api/revenue/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update policy');
      }

      setPolicyVersion(data.policy.version);
      setSuccessMessage(`Recovery policy v${data.policy.version} persisted to PostgreSQL successfully.`);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update settings');
    } finally {
      setIsSaving(false);
    }
  };

  const togglePriority = (p: string) => {
    if (!isPrivileged) return;
    setAllowedPriorities(prev => 
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    );
  };

  const toggleAction = (a: string) => {
    if (!isPrivileged) return;
    setAllowedActions(prev => 
      prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]
    );
  };

  if (isLoading) {
    return (
      <div className="max-w-[1000px] mx-auto p-12 text-center text-sm text-gray-500">
        Loading database recovery policies...
      </div>
    );
  }

  return (
    <div className="max-w-[1000px] mx-auto space-y-8 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Recovery Policies & Engine Settings</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Configure automated financial guardrails, policy thresholds, and execution safety limits.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900/50">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
            Mode: AUDIT (Safe Simulation)
          </div>
          <span className="px-2.5 py-1 rounded text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
            Policy Version: v{policyVersion}
          </span>
          {!isPrivileged && (
            <span className="px-2.5 py-1 rounded text-xs font-semibold bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50">
              Read Only (Member)
            </span>
          )}
        </div>
      </div>

      <div className="bg-indigo-50/60 dark:bg-indigo-950/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-between text-xs text-indigo-900 dark:text-indigo-200">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-bold">
            ⚡
          </div>
          <div>
            <p className="font-semibold text-sm">Automated Dunning Cadence Defaults</p>
            <p className="text-gray-600 dark:text-gray-400 mt-0.5">
              Engine cadence progresses across Day 1 (Initial Notice) → Day 3 (+2 days) → Day 7 (+4 days) with dynamic single-use token generation.
            </p>
          </div>
        </div>
        <span className="px-2.5 py-1 rounded bg-white dark:bg-[#18181b] border border-indigo-200 dark:border-indigo-800 font-mono text-[11px]">
          3-Stage Cadence Active
        </span>
      </div>

      {successMessage && (
        <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300 text-sm font-medium">
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div className="p-4 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-800 dark:text-rose-300 text-sm font-medium">
          {errorMessage}
        </div>
      )}

      <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
        
        {/* Automation Mode */}
        <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Autonomous Execution Kill Switch</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              When enabled, opportunities within thresholds are recovered automatically without requiring manual review.
            </p>
          </div>
          <div className="flex-1 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input 
                type="radio" 
                name="autoExecution" 
                checked={autoExecutionEnabled}
                onChange={() => isPrivileged && setAutoExecutionEnabled(true)}
                disabled={!isPrivileged}
                className="w-4 h-4 text-emerald-600 focus:ring-emerald-600"
              />
              <div>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-200">Autonomous Recovery Enabled</span>
                <p className="text-xs text-gray-500">Executes actions matching policy rules automatically.</p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input 
                type="radio" 
                name="autoExecution" 
                checked={!autoExecutionEnabled}
                onChange={() => isPrivileged && setAutoExecutionEnabled(false)}
                disabled={!isPrivileged}
                className="w-4 h-4 text-amber-600 focus:ring-amber-600"
              />
              <div>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-200">Manual Approval Mode (Kill Switch Active)</span>
                <p className="text-xs text-gray-500">All actions require explicit Owner/Admin approval.</p>
              </div>
            </label>
          </div>
        </div>

        {/* Financial Limits */}
        <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Max Auto-Execute Threshold (₹ INR)</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Opportunities with value above this threshold will require human review before recovery is executed.
            </p>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 max-w-xs">
              <span className="text-sm font-semibold text-gray-500">₹</span>
              <input 
                type="number"
                value={maxAmountINR}
                onChange={e => setMaxAmountINR(Math.max(0, parseInt(e.target.value || '0', 10)))}
                disabled={!isPrivileged}
                className="w-full px-3 py-2 bg-white dark:bg-[#18181b] border border-gray-200 dark:border-gray-700 rounded-md text-sm font-semibold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white disabled:opacity-50"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1.5">Default ₹10,000 limit protects against high-risk auto-debits.</p>
          </div>
        </div>

        {/* Execution Safety & Cooldown */}
        <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Retry Cooldown & Max Attempts</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Prevents spamming customers or card networks during payment recovery.
            </p>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Cooldown (Minutes)</label>
              <input 
                type="number"
                value={cooldownMinutes}
                onChange={e => setCooldownMinutes(Math.max(1, parseInt(e.target.value || '1', 10)))}
                disabled={!isPrivileged}
                className="w-full px-3 py-2 bg-white dark:bg-[#18181b] border border-gray-200 dark:border-gray-700 rounded-md text-sm font-semibold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Max Attempts</label>
              <input 
                type="number"
                value={maxAttempts}
                onChange={e => setMaxAttempts(Math.max(1, Math.min(10, parseInt(e.target.value || '1', 10))))}
                disabled={!isPrivileged}
                className="w-full px-3 py-2 bg-white dark:bg-[#18181b] border border-gray-200 dark:border-gray-700 rounded-md text-sm font-semibold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        {/* Allowed Priorities */}
        <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Allowed Priority Tiers</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Only opportunities matching selected priorities qualify for automated recovery.
            </p>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-3">
            {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(p => (
              <label key={p} className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox"
                  checked={allowedPriorities.includes(p)}
                  onChange={() => togglePriority(p)}
                  disabled={!isPrivileged}
                  className="rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                />
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{p}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Allowed Action Types */}
        <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Permitted Action Types</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Select which execution channels the automated worker is authorized to invoke.
            </p>
          </div>
          <div className="flex-1 space-y-2">
            {[
              { id: 'RETRY_PAYMENT', label: 'Payment Retry (Card/Auto-charge)' },
              { id: 'SEND_PAYMENT_REMINDER', label: 'Payment Reminder (Customer Email)' },
              { id: 'ESCALATE', label: 'Escalate to Account Team' },
              { id: 'CONTACT_CUSTOMER', label: 'Direct Customer Outreach' },
              { id: 'RECOVER_CHECKOUT', label: 'Checkout Recovery Link' },
              { id: 'RETRY_SUBSCRIPTION', label: 'Subscription Invoice Retry' }
            ].map(a => (
              <label key={a.id} className="flex items-center gap-2.5 cursor-pointer">
                <input 
                  type="checkbox"
                  checked={allowedActions.includes(a.id)}
                  onChange={() => toggleAction(a.id)}
                  disabled={!isPrivileged}
                  className="rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">{a.label}</span>
              </label>
            ))}
          </div>
        </div>

      </div>

      {isPrivileged && (
        <div className="flex justify-end gap-3 pt-4">
          <button
            onClick={resetPolicies}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-[#18181b] border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2 text-sm font-medium text-white bg-gray-900 dark:bg-white dark:text-gray-900 rounded-md hover:bg-gray-800 dark:hover:bg-gray-100 shadow-sm transition-colors flex items-center gap-2"
          >
            {isSaving && <div className="w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-900 border-t-transparent animate-spin" />}
            Save Policy Changes
          </button>
        </div>
      )}
    </div>
  );
}
