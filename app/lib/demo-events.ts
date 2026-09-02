import { RevenueEvent } from '../types';

export const rawEvents: RevenueEvent[] = [
  {
    id: 'evt-001',
    type: 'payment_failed',
    customerId: 'cust_acme',
    customerName: 'Acme Corp',
    amount: 12500,
    timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(), // 15 mins ago
    metadata: {
      errorCode: '402',
      paymentMethod: 'credit_card',
      previousFailures: 1,
      customerTenureMonths: 24
    }
  },
  {
    id: 'evt-002',
    type: 'invoice_unpaid',
    customerId: 'cust_globex',
    customerName: 'Globex Inc.',
    amount: 34000,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), // 2 days ago
    metadata: {
      invoiceId: 'INV-2023-089',
      daysPastDue: 30,
      averagePaymentDays: 45
    }
  },
  {
    id: 'evt-003',
    type: 'subscription_expired',
    customerId: 'cust_umbrella',
    customerName: 'Umbrella Corporation',
    amount: 15600,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), // 5 hours ago
    metadata: {
      plan: 'Enterprise Annual',
      activeUsers: 145,
      usageDropoff: false
    }
  },
  {
    id: 'evt-004',
    type: 'churn_signal',
    customerId: 'cust_initech',
    customerName: 'Initech',
    amount: 8200,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(), // 3 days ago
    metadata: {
      usageDropPercent: 70,
      lastLoginDaysAgo: 14,
      plan: 'Pro'
    }
  },
  {
    id: 'evt-005',
    type: 'cart_abandoned',
    customerId: 'cust_soylent',
    customerName: 'Soylent Corp',
    amount: 4500,
    timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(), // 2 hours ago
    metadata: {
      itemsInCart: 3,
      checkoutStep: 'billing_address',
      validationErrors: 1
    }
  }
];
