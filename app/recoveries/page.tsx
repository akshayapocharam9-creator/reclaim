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
        <MetricCard title="Recovered" value={`$${recoveredAmount.toLocaleString()}`} />
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
                <th className="px-6 py-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {activeOpps.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">No active recoveries. Approve an opportunity to see it here.</td>
                </tr>
              ) : activeOpps.map((opp) => (
                <tr key={opp.id} className="hover:bg-gray-50 dark:hover:bg-[#18181b] transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-200">{opp.customerName}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">${opp.amount.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{opp.analysis.recommendedAction}</td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-500">
                    {new Date(opp.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold border border-blue-200 text-blue-700 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800">
                      {opp.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
