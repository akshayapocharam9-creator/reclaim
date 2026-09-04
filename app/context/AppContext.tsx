/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import { RecoveryOpportunity, AgentActivity, AppSettings, RecoveryStatus, Integration, IntegrationStatus } from '../types';
import { ReclaimAgent } from '../lib/agent';

interface AppContextType {
  opportunities: RecoveryOpportunity[];
  activities: AgentActivity[];
  settings: AppSettings;
  integrations: Integration[];
  approveOpportunity: (id: string) => void;
  dismissOpportunity: (id: string) => void;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  updateIntegration: (id: string, updates: Partial<Integration>) => void;
  decision: { opportunity: RecoveryOpportunity, explanation: string } | null;
  analytics: any | null;
  auditEvents: any[];
  refreshData: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const reclaimAgent = useMemo(() => new ReclaimAgent(), []);

  const [opportunities, setOpportunities] = useState<RecoveryOpportunity[]>([]);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [analytics, setAnalytics] = useState<any | null>(null);
  const [auditEvents, setAuditEvents] = useState<any[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    approvalMode: 'manual',
    notifications: 'important',
    riskThreshold: 1000,
    agentActive: true,
  });

  const [integrations, setIntegrations] = useState<Integration[]>([
    { id: 'stripe', name: 'Stripe', category: 'Payment Gateway', icon: 'S', description: 'Recover failed payments and track MRR.', syncData: ['Payment failures', 'Successful payments', 'Subscriptions'], status: 'not_connected' },
    { id: 'shopify', name: 'Shopify', category: 'E-commerce', icon: 'Sh', description: 'Recover abandoned carts and track sales.', syncData: ['Orders', 'Abandoned carts', 'Customer information'], status: 'not_connected' },
    { id: 'quickbooks', name: 'QuickBooks', category: 'Accounting', icon: 'Q', description: 'Monitor unpaid invoices and outstanding balances.', syncData: ['Invoices', 'Payments', 'Outstanding balances'], status: 'not_connected' },
    { id: 'salesforce', name: 'Salesforce', category: 'CRM', icon: 'Sf', description: 'Track customer value and opportunities.', syncData: ['Customers', 'Opportunities', 'Account value'], status: 'not_connected' },
    { id: 'hubspot', name: 'HubSpot', category: 'CRM', icon: 'H', description: 'Sync deals, contacts, and customer activity.', syncData: ['Contacts', 'Deals', 'Customer activity'], status: 'not_connected' },
  ]);

  const [isLoaded, setIsLoaded] = useState(false);

  const fetchAllData = async () => {
    try {
      const [oppRes, analyticsRes, auditRes, integRes] = await Promise.all([
        fetch('/api/revenue/opportunities'),
        fetch('/api/revenue/analytics'),
        fetch('/api/revenue/audit?limit=20'),
        fetch('/api/revenue/integrations')
      ]);

      if (oppRes.ok) {
        const data = await oppRes.json();
        setOpportunities(data.opportunities || []);
        if (data.opportunities && data.opportunities.length > 0) {
          setActivities(reclaimAgent.generateActivities(data.opportunities));
        } else {
          setActivities([]);
        }
      }

      if (analyticsRes.ok) {
        const aData = await analyticsRes.json();
        setAnalytics(aData);
      }

      if (auditRes.ok) {
        const auData = await auditRes.json();
        setAuditEvents(auData.auditEvents || []);
      }

      if (integRes.ok) {
        const iData = await integRes.json();
        if (Array.isArray(iData.integrations)) {
          const mapped: Integration[] = iData.integrations.map((i: any) => ({
            id: i.id,
            name: i.name,
            category: i.category,
            icon: i.name.charAt(0),
            description: i.description,
            syncData: i.supportedEvents || [i.category],
            status: i.status === 'HEALTHY' ? 'connected' : (i.status === 'DEGRADED' ? 'connecting' : 'not_connected'),
            lastSync: i.lastEventAt ? 'Active' : undefined
          }));
          setIntegrations(mapped);
        }
      }
    } catch (error) {
      console.error('Failed to load live pipeline data:', error);
    } finally {
      setIsLoaded(true);
    }
  };

  // Fetch live intelligence from backend pipeline
  useEffect(() => {
    fetchAllData();
  }, []);

  // Load local settings
  useEffect(() => {
    const savedSettings = localStorage.getItem('reclaim_settings');
    if (savedSettings) {
      try {
        setSettings(JSON.parse(savedSettings));
      } catch {
        console.error('Failed to parse settings');
      }
    }

    const savedIntegrations = localStorage.getItem('reclaim_integrations');
    if (savedIntegrations) {
      try {
        const parsed = JSON.parse(savedIntegrations) as Integration[];
        // Merge saved statuses into base integrations
        setIntegrations(prev => prev.map(i => {
          const s = parsed.find(p => p.id === i.id);
          return s ? { ...i, status: s.status, lastSync: s.lastSync } : i;
        }));
      } catch {
        console.error('Failed to parse integrations');
      }
    }

    setIsLoaded(true);
  }, []);

  const updateIntegration = (id: string, updates: Partial<Integration>) => {
    setIntegrations(prev => {
      const next = prev.map(i => i.id === id ? { ...i, ...updates } : i);
      localStorage.setItem('reclaim_integrations', JSON.stringify(next));
      return next;
    });
  };

  const updateOpportunityStatus = (id: string, status: RecoveryStatus, message: string) => {
    setOpportunities(prev => 
      prev.map(opp => opp.id === id ? { ...opp, status } : opp)
    );

    setActivities(prev => [
      {
        id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: 'Just now',
        message,
        type: 'action'
      },
      ...prev
    ]);
  };

  const approveOpportunity = (id: string) => {
    const opp = opportunities.find(o => o.id === id);
    if (opp) {
      updateOpportunityStatus(id, 'queued_for_recovery', `Action approved for ${opp.customerName}. Queued for recovery.`);
    }
  };

  const dismissOpportunity = (id: string) => {
    const opp = opportunities.find(o => o.id === id);
    if (opp) {
      updateOpportunityStatus(id, 'dismissed', `Opportunity dismissed for ${opp.customerName}.`);
    }
  };

  const updateSettings = (newSettings: Partial<AppSettings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      localStorage.setItem('reclaim_settings', JSON.stringify(updated));
      return updated;
    });
  };

  // Apply Risk Threshold Filter to pending opportunities
  const filteredOpportunities = useMemo(() => {
    return opportunities.filter(opp => {
      if (opp.status === 'pending' && opp.amount < settings.riskThreshold) {
        return false;
      }
      return true;
    });
  }, [opportunities, settings.riskThreshold]);

  // If agent is inactive, decision is null
  const decision = useMemo(() => {
    if (!settings.agentActive) return null;
    return reclaimAgent.determineNextBestAction(filteredOpportunities);
  }, [filteredOpportunities, reclaimAgent, settings.agentActive]);

  // Filter activities based on notification preference
  const visibleActivities = useMemo(() => {
    if (settings.notifications === 'none') return [];
    if (settings.notifications === 'important') {
      return activities.filter(a => a.type === 'alert' || a.type === 'action');
    }
    return activities;
  }, [activities, settings.notifications]);

  return (
    <AppContext.Provider value={{
      opportunities: filteredOpportunities,
      activities: visibleActivities,
      settings,
      integrations,
      approveOpportunity,
      dismissOpportunity,
      updateSettings,
      updateIntegration,
      decision,
      analytics,
      auditEvents,
      refreshData: fetchAllData
    }}>
      {isLoaded ? children : <div className="p-8 flex justify-center text-gray-500">Loading workspace...</div>}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
