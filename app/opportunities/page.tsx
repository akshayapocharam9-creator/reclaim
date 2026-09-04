'use client';
import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import OpportunityList from '../components/OpportunityList';

export default function OpportunitiesPage() {
  const { opportunities, approveOpportunity, dismissOpportunity } = useAppContext();
  
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const filteredOpps = opportunities
    .filter(o => statusFilter === 'all' || o.status === statusFilter)
    .filter(o => priorityFilter === 'all' || o.priority === priorityFilter)
    .filter(o => 
      o.customerName.toLowerCase().includes(search.toLowerCase()) || 
      o.analysis.problem.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => sortOrder === 'desc' ? b.amount - a.amount : a.amount - b.amount);

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Opportunities</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Manage and review detected revenue recovery opportunities.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <input 
            type="text"
            placeholder="Search customers..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-[#09090b] border border-gray-200 dark:border-gray-800 rounded-md text-sm w-full md:w-64 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white"
          />
          <select 
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-[#09090b] border border-gray-200 dark:border-gray-800 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending (Detected)</option>
            <option value="in_progress">In Progress</option>
            <option value="recovered">Recovered</option>
            <option value="lost">Lost / Failed</option>
            <option value="dismissed">Dismissed</option>
          </select>
          <select 
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-[#09090b] border border-gray-200 dark:border-gray-800 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white"
          >
            <option value="all">All Priorities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          <button 
            onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
            className="px-3 py-2 bg-white dark:bg-[#09090b] border border-gray-200 dark:border-gray-800 rounded-md text-sm flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-[#18181b]"
          >
            Amount {sortOrder === 'desc' ? '↓' : '↑'}
          </button>
        </div>
      </div>

      <OpportunityList 
        opportunities={filteredOpps} 
        onApprove={approveOpportunity}
        onDismiss={dismissOpportunity}
      />
    </div>
  );
}
