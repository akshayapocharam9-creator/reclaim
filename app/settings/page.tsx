'use client';
import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { AppSettings } from '../types';

export default function SettingsPage() {
  const { settings, updateSettings } = useAppContext();
  
  // Local state for immediate form responsiveness, sync to context on save
  const [localSettings, setLocalSettings] = useState(settings);
  const [isSaved, setIsSaved] = useState(false);

  const defaultSettings: AppSettings = {
    approvalMode: 'manual',
    notifications: 'important',
    riskThreshold: 1000,
    agentActive: true,
  };

  const handleSave = () => {
    updateSettings(localSettings);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleReset = () => {
    setLocalSettings(defaultSettings);
    updateSettings(defaultSettings);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  return (
    <div className="max-w-[1000px] mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Settings</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Manage how RECLAIM identifies and handles revenue recovery.</p>
      </div>

      <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
        
        {/* Recovery Approval Mode */}
        <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Recovery Approval Mode</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">Determine how RECLAIM executes recovery actions.</p>
          </div>
          <div className="flex-1 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input 
                type="radio" 
                name="approvalMode" 
                value="manual"
                checked={localSettings.approvalMode === 'manual'}
                onChange={() => setLocalSettings({ ...localSettings, approvalMode: 'manual' })}
                className="w-4 h-4 text-gray-900 focus:ring-gray-900"
              />
              <span className="text-sm font-medium text-gray-900 dark:text-gray-200">Manual Approval</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input 
                type="radio" 
                name="approvalMode" 
                value="agent"
                checked={localSettings.approvalMode === 'agent'}
                onChange={() => setLocalSettings({ ...localSettings, approvalMode: 'agent' })}
                className="w-4 h-4 text-gray-900 focus:ring-gray-900"
              />
              <span className="text-sm font-medium text-gray-900 dark:text-gray-200">Agent Recommendations</span>
            </label>
          </div>
        </div>

        {/* Notifications */}
        <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Notifications</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">Select which events trigger alerts in the dashboard.</p>
          </div>
          <div className="flex-1">
            <select 
              value={localSettings.notifications}
              onChange={(e) => setLocalSettings({ ...localSettings, notifications: e.target.value as 'important' | 'all' | 'none' })}
              className="w-full px-3 py-2 bg-white dark:bg-[#18181b] border border-gray-200 dark:border-gray-700 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white"
            >
              <option value="important">Important Opportunities Only (High/Critical)</option>
              <option value="all">All Opportunities</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>

        {/* Risk Threshold */}
        <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Risk Threshold</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">Only flag revenue at risk above this amount.</p>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-4">
              <input 
                type="range" 
                min="0" 
                max="10000" 
                step="100"
                value={localSettings.riskThreshold}
                onChange={(e) => setLocalSettings({ ...localSettings, riskThreshold: parseInt(e.target.value) || 0 })}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
              />
              <span className="text-sm font-semibold text-gray-900 dark:text-white min-w-[80px] text-right">
                ${localSettings.riskThreshold.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Agent Toggle */}
        <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Intelligence Engine</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">Toggle background event analysis.</p>
          </div>
          <div className="flex-shrink-0">
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer"
                checked={localSettings.agentActive}
                onChange={(e) => setLocalSettings({ ...localSettings, agentActive: e.target.checked })}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-gray-200 dark:peer-focus:ring-gray-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-gray-900 dark:peer-checked:bg-gray-100"></div>
            </label>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center">
        <button 
          onClick={handleReset}
          className="px-4 py-2 text-gray-600 dark:text-gray-400 text-sm font-medium hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          Reset to Defaults
        </button>
        <div className="flex items-center gap-4">
          {isSaved && <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1 rounded-md border border-emerald-100 dark:border-emerald-800">Settings saved</span>}
          <button 
            onClick={handleSave}
            className="px-6 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium rounded-md text-sm shadow-sm hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
          >
            Save Preferences
          </button>
        </div>
      </div>
    </div>
  );
}
