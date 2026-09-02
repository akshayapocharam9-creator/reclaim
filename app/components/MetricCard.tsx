import React from 'react';

interface MetricCardProps {
  title: string;
  value: string;
  trend?: {
    value: number;
    label: string;
    isPositive: boolean;
  };
  variant?: 'primary' | 'secondary';
}

export default function MetricCard({ title, value, trend, variant = 'secondary' }: MetricCardProps) {
  if (variant === 'primary') {
    return (
      <div className="p-6 md:p-8 bg-gray-900 dark:bg-gray-50 rounded-xl border border-gray-900 dark:border-gray-100 text-white dark:text-gray-900 shadow-lg relative overflow-hidden">
        {/* Subtle background element */}
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 rounded-full bg-white/5 dark:bg-black/5 blur-3xl pointer-events-none"></div>
        
        <h3 className="text-sm font-medium text-gray-300 dark:text-gray-600 tracking-wide uppercase">
          {title}
        </h3>
        <p className="mt-3 text-4xl md:text-5xl font-semibold tracking-tight">
          {value}
        </p>
        {trend && (
          <div className="mt-4 flex items-center text-sm">
            <span className="font-medium text-emerald-400 dark:text-emerald-600 bg-emerald-400/10 dark:bg-emerald-600/10 px-2 py-0.5 rounded-full">
              {trend.isPositive ? '+' : '-'}{Math.abs(trend.value)}%
            </span>
            <span className="ml-3 text-gray-400 dark:text-gray-500">
              {trend.label}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 bg-white dark:bg-[#09090b] rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow">
      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
        {title}
      </h3>
      <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100 tracking-tight">
        {value}
      </p>
      {trend && (
        <div className="mt-3 flex items-center text-sm">
          <span className={`font-medium ${trend.isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {trend.isPositive ? '+' : '-'}{Math.abs(trend.value)}%
          </span>
          <span className="ml-2 text-gray-500 dark:text-gray-500">
            {trend.label}
          </span>
        </div>
      )}
    </div>
  );
}
