'use client';
import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { Integration } from '../types';

export default function IntegrationsPage() {
  const { integrations, updateIntegration } = useAppContext();
  
  const [connectModal, setConnectModal] = useState<Integration | null>(null);
  const [disconnectModal, setDisconnectModal] = useState<Integration | null>(null);
  const [viewDataModal, setViewDataModal] = useState<Integration | null>(null);
  
  const [isConnecting, setIsConnecting] = useState(false);

  const connectedCount = integrations.filter(i => i.status === 'connected').length;
  
  const handleConnect = (integration: Integration) => {
    setIsConnecting(true);
    updateIntegration(integration.id, { status: 'connecting' });
    
    setTimeout(() => {
      updateIntegration(integration.id, { 
        status: 'connected', 
        lastSync: 'Just now' 
      });
      setIsConnecting(false);
      setConnectModal(null);
    }, 1500);
  };

  const handleDisconnect = (integration: Integration) => {
    updateIntegration(integration.id, { status: 'not_connected', lastSync: undefined });
    setDisconnectModal(null);
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 pb-12">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Integrations</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Connect RECLAIM to your existing payment and customer systems.</p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Connected</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">{connectedCount}</p>
        </div>
        <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Available</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">{integrations.length - connectedCount}</p>
        </div>
        <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Last Global Sync</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white mt-2">
            {connectedCount > 0 ? 'Just now' : 'N/A'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {integrations.map((integration) => (
          <div key={integration.id} className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl p-6 flex flex-col h-full transition-all hover:border-gray-300 dark:hover:border-gray-700">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center font-bold text-gray-400 dark:text-gray-500 text-xl">
                {integration.icon}
              </div>
              {integration.status === 'connected' ? (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Connected
                </span>
              ) : integration.status === 'connecting' ? (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span> Connecting
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-800">
                  Not Connected
                </span>
              )}
            </div>
            
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">{integration.name}</h3>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider mb-3">{integration.category}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 flex-1">{integration.description}</p>
            
            {integration.status === 'connected' && (
              <div className="mb-4 p-3 bg-gray-50 dark:bg-[#18181b] rounded-lg border border-gray-100 dark:border-gray-800">
                <p className="text-xs text-gray-500">Last sync: <span className="font-semibold text-gray-700 dark:text-gray-300">{integration.lastSync}</span></p>
                <p className="text-xs text-gray-500 mt-1">Data: <span className="font-semibold text-gray-700 dark:text-gray-300">Demo events synced</span></p>
              </div>
            )}

            <div className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-800 flex gap-3">
              {integration.status === 'connected' ? (
                <>
                  <button 
                    onClick={() => setViewDataModal(integration)}
                    className="flex-1 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium rounded-md text-sm shadow-sm hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
                  >
                    View Data
                  </button>
                  <button 
                    onClick={() => setDisconnectModal(integration)}
                    className="px-4 py-2 bg-white dark:bg-transparent text-rose-600 dark:text-rose-500 font-medium rounded-md text-sm border border-gray-200 dark:border-gray-800 hover:bg-rose-50 dark:hover:bg-rose-950/20 hover:border-rose-200 dark:hover:border-rose-900/50 transition-colors"
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button 
                  onClick={() => setConnectModal(integration)}
                  disabled={integration.status === 'connecting'}
                  className="w-full py-2 bg-white dark:bg-transparent text-gray-900 dark:text-white font-medium rounded-md text-sm border border-gray-200 dark:border-gray-700 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  {integration.status === 'connecting' ? 'Connecting...' : 'Connect'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* CONNECT MODAL */}
      {connectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/20 dark:bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#09090b] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
            <div className="p-6 md:p-8 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center font-bold text-gray-400 text-xl">
                  {connectModal.icon}
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">Connect {connectModal.name}</h3>
                  <p className="text-sm text-gray-500">Authorize RECLAIM to monitor revenue signals.</p>
                </div>
              </div>
              
              <div className="bg-blue-50 dark:bg-blue-950/20 text-blue-800 dark:text-blue-300 p-4 rounded-lg text-sm border border-blue-100 dark:border-blue-900/50 mb-6">
                <p className="font-semibold mb-1">Demo Connection</p>
                <p>No external service is connected. This simulates a successful connection and unlocks demo data for the overview pipeline.</p>
              </div>

              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Data to be synchronized:</p>
                <ul className="space-y-2">
                  {connectModal.syncData.map((data, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                      {data}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="p-4 bg-gray-50 dark:bg-[#18181b] flex justify-end gap-3">
              <button 
                onClick={() => setConnectModal(null)}
                disabled={isConnecting}
                className="px-5 py-2 text-gray-600 dark:text-gray-400 font-medium text-sm hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => handleConnect(connectModal)}
                disabled={isConnecting}
                className="px-5 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium rounded-lg text-sm shadow-sm hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors disabled:opacity-70"
              >
                {isConnecting ? 'Connecting...' : 'Connect Demo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DISCONNECT MODAL */}
      {disconnectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/20 dark:bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#09090b] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl w-full max-w-sm overflow-hidden flex flex-col">
            <div className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/50 flex items-center justify-center text-rose-600 dark:text-rose-500 mx-auto mb-4">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Disconnect {disconnectModal.name}?</h3>
              <p className="text-sm text-gray-500">RECLAIM will no longer sync revenue signals from this integration. Data will remain in your history.</p>
            </div>
            <div className="p-4 bg-gray-50 dark:bg-[#18181b] flex gap-3">
              <button 
                onClick={() => setDisconnectModal(null)}
                className="flex-1 py-2 text-gray-600 dark:text-gray-400 font-medium text-sm hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => handleDisconnect(disconnectModal)}
                className="flex-1 py-2 bg-rose-600 text-white font-medium rounded-lg text-sm shadow-sm hover:bg-rose-700 transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW DATA MODAL */}
      {viewDataModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/20 dark:bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#09090b] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-[#09090b]">
              <div className="flex items-center gap-3">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400">Demo Data</span>
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight">{viewDataModal.name} Sync Preview</h3>
              </div>
              <button onClick={() => setViewDataModal(null)} className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            
            <div className="p-0 max-h-[60vh] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-[#18181b]/50 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider sticky top-0">
                    <th className="px-6 py-3">Event Type</th>
                    <th className="px-6 py-3">Value</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {viewDataModal.syncData.map((type, i) => (
                    <React.Fragment key={i}>
                      <tr className="hover:bg-gray-50 dark:hover:bg-[#18181b]">
                        <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-200">{type}</td>
                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">${((i + 1) * 1234 % 5000 + 500).toLocaleString()}</td>
                        <td className="px-6 py-4"><span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30">Synced</span></td>
                        <td className="px-6 py-4 text-sm text-gray-500">2 min ago</td>
                      </tr>
                      <tr className="hover:bg-gray-50 dark:hover:bg-[#18181b]">
                        <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-200">{type}</td>
                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">${((i + 2) * 2345 % 5000 + 500).toLocaleString()}</td>
                        <td className="px-6 py-4"><span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30">Synced</span></td>
                        <td className="px-6 py-4 text-sm text-gray-500">1 hr ago</td>
                      </tr>
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="p-4 bg-gray-50 dark:bg-[#18181b] flex justify-end">
              <button 
                onClick={() => setViewDataModal(null)}
                className="px-5 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium rounded-lg text-sm shadow-sm hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
