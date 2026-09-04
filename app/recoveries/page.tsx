'use client';
import React from 'react';
import { useAppContext } from '../context/AppContext';
import MetricCard from '../components/MetricCard';

export default function RecoveriesPage() {
  const { opportunities } = useAppContext();
  
  const activeOpps = opportunities.filter(o => o.status !== 'pending' && o.status !== 'dismissed');
  
  const queuedCount = opportunities.filter(o => o.status === 'queued_for_recovery').length;
  const recoveredAmount = opportunities.filter(o => o.status === 'recovered').reduce((sum, opp) => sum + opp.amount, 0);

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Recoveries</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Track the status of approved revenue recovery operations.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <MetricCard title="Total Opportunities" value={opportunities.length.toString()} />
        <MetricCard title="Approved Actions" value={activeOpps.length.toString()} />
        <MetricCard title="Queued" value={queuedCount.toString()} />
        <MetricCard title="Recovered" value={`₹${recoveredAmount.toLocaleString()}`} />
      </div>
      
      <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden mt-8">
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Active Recovery Operations</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-[#18181b]/50 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th className="px-6 py-4">Customer</th>
                <th className="px-6 py-4">Original Amount</th>
                <th className="px-6 py-4">Action</th>
                <th className="px-6 py-4">Date Approved</th>
                <th className="px-6 py-4">Cadence</th>
                <th className="px-6 py-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {activeOpps.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 px-6 text-center text-sm text-gray-500">
                    <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 flex items-center justify-center mx-auto mb-2 font-bold text-base">
                      ⚡
                    </div>
                    No active recovery workflows in progress. Authorize an action from Opportunities to track execution.
                  </td>
                </tr>
              ) : activeOpps.map((opp) => {
                const o = opp as typeof opp & { dunningStep?: number, dunningStatus?: string };
                return (
                <tr key={o.id} className="hover:bg-gray-50 dark:hover:bg-[#18181b] transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-200">{o.customerName}</td>
                  <td className="px-6 py-4 text-sm font-semibold text-gray-900 dark:text-gray-100">₹{o.amount.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{o.analysis?.recommendedAction || 'Contact Customer'}</td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-500">
                    {new Date(o.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4">
                    {o.dunningStep ? (
                      <span className="px-2.5 py-1 rounded text-[10px] uppercase tracking-wider font-semibold border border-purple-200 text-purple-700 bg-purple-50 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800">
                        Step {o.dunningStep} (Day {o.dunningStep === 1 ? 1 : o.dunningStep === 2 ? 3 : 7})
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded text-[10px] uppercase tracking-wider font-semibold border ${
                      o.status === 'recovered' 
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                        : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
                    }`}>
                      {o.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              )})
            }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
