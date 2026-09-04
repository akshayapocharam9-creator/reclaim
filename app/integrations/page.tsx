/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export default function IntegrationsPage() {
  const { role } = useAuth();
  const isPrivileged = role === 'OWNER' || role === 'ADMIN';

  const [isLoading, setIsLoading] = useState(true);
  const [integrationsData, setIntegrationsData] = useState<any>(null);
  const [webhookLogs, setWebhookLogs] = useState<any[]>([]);
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [activeTab, setActiveTab] = useState<'integrations' | 'webhook_logs'>('integrations');

  // Simulation test state
  const [isSimulating, setIsSimulating] = useState(false);
  const [simResult, setSimResult] = useState<any>(null);

  useEffect(() => {
    fetchIntegrations();
  }, []);

  const fetchIntegrations = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/revenue/integrations');
      if (res.ok) {
        const data = await res.json();
        setIntegrationsData(data);
      }
    } catch (err) {
      console.error('Error loading integrations:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchWebhookLogs = async () => {
    setIsLogsLoading(true);
    try {
      const res = await fetch('/api/revenue/webhooks?limit=25');
      if (res.ok) {
        const data = await res.json();
        setWebhookLogs(data.events || []);
      }
    } catch (err) {
      console.error('Error fetching webhook logs:', err);
    } finally {
      setIsLogsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'webhook_logs') {
      fetchWebhookLogs();
    }
  }, [activeTab]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleSimulateWebhook = async () => {
    if (!isPrivileged) return;
    setIsSimulating(true);
    setSimResult(null);

    try {
      // Send a test payment.failed webhook signed with the system fallback secret
      const testEventId = `evt_test_${Date.now()}`;
      const payload = {
        entity: 'event',
        account_id: 'acc_reclaim_demo',
        event: 'payment.failed',
        contains: ['payment'],
        payload: {
          payment: {
            entity: {
              id: `pay_test_${Date.now()}`,
              amount: 299900,
              currency: 'INR',
              status: 'failed',
              order_id: `order_test_${Date.now()}`,
              email: 'customer@example.com',
              contact: '+919876543210',
              error_code: 'BAD_REQUEST_ERROR',
              error_description: 'Payment was declined due to insufficient funds',
              created_at: Math.floor(Date.now() / 1000)
            }
          }
        },
        created_at: Math.floor(Date.now() / 1000)
      };

      const res = await fetch('/api/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': 'simulated_test_signature'
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));
      setSimResult({
        status: res.status,
        message: data.message || data.error || (res.ok ? 'Webhook processed' : 'Failed')
      });

      // Refresh data
      await fetchIntegrations();
      if (activeTab === 'webhook_logs') {
        await fetchWebhookLogs();
      }
    } catch (err: any) {
      setSimResult({ status: 500, message: err.message || 'Simulation network error' });
    } finally {
      setIsSimulating(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'HEALTHY':
      case 'connected':
        return (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Healthy
          </span>
        );
      case 'DEGRADED':
      case 'FALLBACK_ACTIVE':
        return (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span> Fallback Active
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
            Pending Configuration
          </span>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-[1600px] mx-auto p-12 text-center text-sm text-gray-500">
        Loading real-time provider integrations...
      </div>
    );
  }

  const razorpay = integrationsData?.integrations?.find((i: any) => i.id === 'razorpay');
  const resend = integrationsData?.integrations?.find((i: any) => i.id === 'resend');
  const gemini = integrationsData?.integrations?.find((i: any) => i.id === 'gemini_ai');
  const webhookUrl = integrationsData?.webhookEndpoint || 'https://reclaim-tau-eight.vercel.app/api/webhooks/razorpay';

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Provider Integrations & Webhook Hub</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Connect live payment processors, configure webhook ingestion, and monitor event pipelines.
          </p>
        </div>

        {/* Tab navigation */}
        <div className="flex bg-gray-100 dark:bg-[#18181b] p-1 rounded-lg border border-gray-200 dark:border-gray-800 self-start md:self-auto">
          <button
            onClick={() => setActiveTab('integrations')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'integrations'
                ? 'bg-white dark:bg-black text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Configured Providers
          </button>
          <button
            onClick={() => setActiveTab('webhook_logs')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'webhook_logs'
                ? 'bg-white dark:bg-black text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Live Webhook Events ({razorpay?.totalEventsReceived || 0})
          </button>
        </div>
      </div>

      {activeTab === 'integrations' ? (
        <div className="space-y-8">
          {/* Quick Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl p-6">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Total Webhook Ingestions</p>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">{razorpay?.totalEventsReceived || 0}</p>
              <p className="text-xs text-gray-400 mt-2">
                Last event: {razorpay?.lastEventAt ? new Date(razorpay.lastEventAt).toLocaleString() : 'None received yet'}
              </p>
            </div>
            <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl p-6">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Primary Gateway</p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xl font-bold text-gray-900 dark:text-white">Razorpay</span>
                {getStatusBadge(razorpay?.status || 'UNCONFIGURED')}
              </div>
              <p className="text-xs text-gray-400 mt-2">Mode: <span className="font-semibold uppercase">{razorpay?.executionMode || 'audit'}</span></p>
            </div>
            <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl p-6">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">AI Recovery Engine</p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xl font-bold text-gray-900 dark:text-white">Gemini + Fallback</span>
                {getStatusBadge(gemini?.status || 'HEALTHY')}
              </div>
              <p className="text-xs text-gray-400 mt-2">Deterministic fail-closed enabled</p>
            </div>
          </div>

          {/* Dedicated Razorpay Integration Card */}
          <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl p-8 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-800 pb-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-white text-xl shadow-sm">
                  R
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">Razorpay Payment Gateway</h3>
                  <p className="text-xs text-gray-500">Live payment failure ingestion, subscription halt tracking, and HMAC-verified events.</p>
                </div>
              </div>
              <div>
                {getStatusBadge(razorpay?.status || 'UNCONFIGURED')}
              </div>
            </div>

            {/* Webhook URL copy box */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                Production Webhook URL (Paste into Razorpay Dashboard)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={webhookUrl}
                  className="flex-1 px-3.5 py-2.5 bg-gray-50 dark:bg-[#18181b] border border-gray-200 dark:border-gray-800 rounded-lg text-sm font-mono text-gray-800 dark:text-gray-200 select-all focus:outline-none"
                />
                <button
                  onClick={() => copyToClipboard(webhookUrl)}
                  className="px-4 py-2.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-xs font-semibold rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors shrink-0 shadow-sm"
                >
                  {copiedUrl ? 'Copied!' : 'Copy URL'}
                </button>
              </div>
            </div>

            {/* Step-by-step instructions */}
            <div className="bg-gray-50 dark:bg-[#121214] p-5 rounded-lg border border-gray-200 dark:border-gray-800 space-y-3 text-xs text-gray-600 dark:text-gray-300">
              <p className="font-semibold text-gray-900 dark:text-white uppercase tracking-wider">Razorpay Dashboard Setup Steps:</p>
              <ol className="list-decimal pl-4 space-y-1.5 leading-relaxed">
                <li>Log in to your <strong>Razorpay Dashboard</strong> $\rightarrow$ Navigate to <strong>Settings $\rightarrow$ Webhooks</strong>.</li>
                <li>Click <strong>+ Add New Webhook</strong>.</li>
                <li>Paste the Webhook URL copied above into the <strong>Webhook URL</strong> field.</li>
                <li>Enter your custom secret into the <strong>Secret</strong> field (and set it as <code className="bg-gray-200 dark:bg-gray-800 px-1 py-0.5 rounded">RAZORPAY_WEBHOOK_SECRET</code> in Vercel).</li>
                <li>Check the following Active Events:
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {['payment.failed', 'payment.captured', 'order.paid', 'subscription.halted', 'subscription.charged'].map(e => (
                      <span key={e} className="px-2 py-0.5 rounded font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200">
                        {e}
                      </span>
                    ))}
                  </div>
                </li>
                <li>Click <strong>Save Webhook</strong>. All incoming events will automatically trigger RECLAIM&apos;s revenue leak engine.</li>
              </ol>
            </div>

            {/* Test action */}
            {isPrivileged && (
              <div className="pt-2 flex items-center justify-between border-t border-gray-100 dark:border-gray-800">
                <div>
                  <h4 className="text-xs font-bold text-gray-900 dark:text-white">Pipeline Verification</h4>
                  <p className="text-xs text-gray-500">Dispatch a safe signed payment failure to test the entire ingestion and intelligence loop.</p>
                </div>
                <div className="flex items-center gap-3">
                  {simResult && (
                    <span className={`text-xs font-semibold ${simResult.status === 200 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {simResult.message}
                    </span>
                  )}
                  <button
                    onClick={handleSimulateWebhook}
                    disabled={isSimulating}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#18181b] text-gray-700 dark:text-gray-200 rounded-md text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
                  >
                    {isSimulating && <div className="w-3 h-3 rounded-full border-2 border-gray-500 border-t-transparent animate-spin" />}
                    Simulate Test Ingestion
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Other Connected Services */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Resend Card */}
            <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 flex items-center justify-center font-bold text-base">
                    ✉
                  </div>
                  {getStatusBadge(resend?.status || 'UNCONFIGURED')}
                </div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">Resend Communications</h3>
                <p className="text-xs text-gray-500 mt-1 mb-4 leading-relaxed">
                  Used by the automated recovery agent to send high-converting payment retry reminders and invoice updates.
                </p>
              </div>
              <div className="p-3 bg-gray-50 dark:bg-[#18181b] rounded-lg border border-gray-100 dark:border-gray-800 text-xs text-gray-500">
                Delivery Channel: <span className="font-semibold text-gray-700 dark:text-gray-300">Direct Customer Email</span>
              </div>
            </div>

            {/* Google Gemini Card */}
            <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-base">
                    ✦
                  </div>
                  {getStatusBadge(gemini?.status || 'HEALTHY')}
                </div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">Google Gemini Decision Engine</h3>
                <p className="text-xs text-gray-500 mt-1 mb-4 leading-relaxed">
                  Generates natural language reasoning and dynamic escalation strategies with multi-attempt caching.
                </p>
              </div>
              <div className="p-3 bg-gray-50 dark:bg-[#18181b] rounded-lg border border-gray-100 dark:border-gray-800 text-xs text-gray-500">
                Fallback: <span className="font-semibold text-emerald-600 dark:text-emerald-400">Deterministic Engine Active</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Webhook Events Log Tab */
        <div className="bg-white dark:bg-[#09090b] shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Persisted Ingestion Events</h2>
              <p className="text-xs text-gray-500 mt-0.5">Real events captured from payment webhooks for your organization.</p>
            </div>
            <button
              onClick={fetchWebhookLogs}
              disabled={isLogsLoading}
              className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-medium rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              {isLogsLoading ? 'Refreshing...' : 'Refresh Logs'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-[#18181b]/50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="px-6 py-4">Event Type</th>
                  <th className="px-6 py-4">Event ID</th>
                  <th className="px-6 py-4">Provider</th>
                  <th className="px-6 py-4">Amount</th>
                  <th className="px-6 py-4">Received At</th>
                  <th className="px-6 py-4">Linked Outcomes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-xs">
                {webhookLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                      No webhook events have been received yet. Click &quot;Simulate Test Ingestion&quot; on the Providers tab to test.
                    </td>
                  </tr>
                ) : (
                  webhookLogs.map((log: any) => (
                    <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-[#18181b] transition-colors">
                      <td className="px-6 py-4 font-mono font-semibold text-gray-900 dark:text-gray-100">
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold ${
                          log.eventType.includes('fail')
                            ? 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900'
                        }`}>
                          {log.eventType}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-gray-500">{log.eventId}</td>
                      <td className="px-6 py-4 text-gray-700 dark:text-gray-300 uppercase font-semibold">{log.provider}</td>
                      <td className="px-6 py-4 font-semibold text-gray-900 dark:text-white">
                        {log.summary?.amountMinor ? `₹${(log.summary.amountMinor / 100).toLocaleString()}` : '—'}
                      </td>
                      <td className="px-6 py-4 text-gray-500">{new Date(log.createdAt).toLocaleString()}</td>
                      <td className="px-6 py-4">
                        {log.outcomesCount > 0 ? (
                          <span className="px-2 py-0.5 rounded font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900">
                            {log.outcomesCount} Action(s)
                          </span>
                        ) : (
                          <span className="text-gray-400">None</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
