import { DashboardMetrics, ChartDataPoint } from '../types';

export const metricsData: DashboardMetrics = {
  revenueAtRisk: 124500,
  recoverableRevenue: 98200,
  revenueRecovered: 45600,
  recoveryRate: 46.4,
};

export const recoveryChartData: ChartDataPoint[] = [
  { month: 'Jan', recovered: 12000, atRisk: 18000 },
  { month: 'Feb', recovered: 19000, atRisk: 22000 },
  { month: 'Mar', recovered: 15000, atRisk: 16000 },
  { month: 'Apr', recovered: 28000, atRisk: 30000 },
  { month: 'May', recovered: 35000, atRisk: 25000 },
  { month: 'Jun', recovered: 45600, atRisk: 124500 },
];
