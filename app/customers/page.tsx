'use client';
import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { RecoveryOpportunity } from '../types';

interface CustomerProfile {
  name: string;
  totalRevenue: number;
  atRisk: number;
  opportunities: RecoveryOpportunity[];
  latestEvent: string;
}

export default function CustomersPage() {
  const { opportunities } = useAppContext();
  
  // Aggregate data by customer
  const customerMap = opportunities.reduce((acc, opp) => {
    if (!acc[opp.customerName]) {
      // Deterministic pseudo-random revenue based on name length for demo
      const baseRev = (opp.customerName.length * 15000) + 50000;
      
      acc[opp.customerName] = {
        name: opp.customerName,
        totalRevenue: baseRev,
        atRisk: 0,
        opportunities: [],
        latestEvent: opp.analysis.problem
      };
    }
    if (opp.status === 'pending') {
      acc[opp.customerName].atRisk += opp.amount;
    }
    acc[opp.customerName].opportunities.push(opp);
    return acc;
  }, {} as Record<string, CustomerProfile>);

  const customers = Object.values(customerMap);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerProfile | null>(null);

  const getRiskLevel = (atRisk: number, totalRev: number) => {
    const ratio = atRisk / totalRev;
    if (ratio > 0.3) return 'High';
    if (ratio > 0.1) return 'Medium';
    return 'Low';
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'High': return 'text-rose-700 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400 border-rose-200 dark:border-rose-900/50';
      case 'Medium': return 'text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 border-amber-200 dark:border-amber-900/50';
      default: return 'text-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700';
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Customers at Risk</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Identify accounts with significant revenue exposure.</p>
      </div>

      <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden mt-8">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-[#18181b]/50 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th className="px-6 py-4">Customer</th>
                <th className="px-6 py-4">Total Revenue (YTD)</th>
                <th className="px-6 py-4">Amount at Risk</th>
                <th className="px-6 py-4">Risk Level</th>
                <th className="px-6 py-4">Opps</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {customers.map((c, i) => {
                const riskLevel = getRiskLevel(c.atRisk, c.totalRevenue);
                return (
                  <tr key={i} onClick={() => setSelectedCustomer(c)} className="hover:bg-gray-50 dark:hover:bg-[#18181b] transition-colors cursor-pointer">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-200">{c.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">${c.totalRevenue.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">${c.atRisk.toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold border ${getRiskColor(riskLevel)}`}>
                        {riskLevel}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-500">{c.opportunities.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/20 dark:bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#09090b] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-[#09090b]">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Customer Profile</h3>
              <button onClick={() => setSelectedCustomer(null)} className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            
            <div className="p-6 md:p-8">
              <h4 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white mb-6">{selectedCustomer.name}</h4>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="p-4 bg-gray-50 dark:bg-[#18181b] rounded-lg border border-gray-100 dark:border-gray-800">
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Total Revenue</p>
                  <p className="text-xl font-medium text-gray-900 dark:text-gray-100">${selectedCustomer.totalRevenue.toLocaleString()}</p>
                </div>
                <div className="p-4 bg-gray-50 dark:bg-[#18181b] rounded-lg border border-gray-100 dark:border-gray-800">
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">At Risk</p>
                  <p className="text-xl font-medium text-gray-900 dark:text-gray-100">${selectedCustomer.atRisk.toLocaleString()}</p>
                </div>
              </div>

              <div>
                <h5 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Associated Opportunities</h5>
                <ul className="space-y-3">
                  {selectedCustomer.opportunities.map((opp) => (
                    <li key={opp.id} className="text-sm border-l-2 border-gray-200 dark:border-gray-700 pl-3">
                      <span className="font-medium text-gray-900 dark:text-gray-200">${opp.amount.toLocaleString()}</span> — {opp.analysis.problem}
                      <br/>
                      <span className="text-gray-500 text-xs mt-1 block">Status: {opp.status.replace(/_/g, ' ')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
