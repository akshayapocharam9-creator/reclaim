'use client';
import React, { useState } from 'react';

interface ChartDataPoint {
  label: string;
  recovered: number;
  atRisk: number;
}

interface RecoveryChartProps {
  data: ChartDataPoint[];
  dateRange: string;
}

export default function RecoveryChart({ data, dateRange }: RecoveryChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const maxVal = Math.max(...data.map(d => Math.max(d.recovered, d.atRisk)), 1);
  
  return (
    <div className="bg-white dark:bg-[#09090b] p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm h-full flex flex-col">
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Recovery Performance</h3>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-1">{dateRange} Trend Analysis</p>
        </div>
      </div>
      
      <div className="flex-1 flex items-end gap-2 md:gap-4 h-48 mt-auto relative">
        {data.map((point, i) => {
          const recoveredHeight = (point.recovered / maxVal) * 100;
          const atRiskHeight = (point.atRisk / maxVal) * 100;
          const isHovered = hoveredIdx === i;
          
          return (
            <div 
              key={i} 
              className="flex-1 flex flex-col items-center gap-2 group relative h-full"
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <div className="w-full relative flex items-end justify-center h-full cursor-pointer">
                {/* Tooltip */}
                {isHovered && (
                  <div className="absolute -top-16 left-1/2 -translate-x-1/2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-xs rounded shadow-xl p-2 z-50 min-w-[120px] pointer-events-none">
                    <p className="font-bold border-b border-gray-700 dark:border-gray-200 pb-1 mb-1">{point.label}</p>
                    <p className="flex justify-between"><span>At Risk:</span> <span className="font-semibold">₹{point.atRisk.toLocaleString()}</span></p>
                    <p className="flex justify-between"><span>Recovered:</span> <span className="font-semibold">₹{point.recovered.toLocaleString()}</span></p>
                  </div>
                )}
                
                {/* At Risk Bar (Background/Lighter) */}
                <div 
                  className={`absolute w-full max-w-[32px] rounded-t-sm transition-all duration-300 ${isHovered ? 'bg-gray-200 dark:bg-gray-700' : 'bg-gray-100 dark:bg-gray-800'}`}
                  style={{ height: `${Math.max(atRiskHeight, 2)}%` }}
                ></div>
                {/* Recovered Bar (Foreground/Darker) */}
                <div 
                  className={`absolute w-full max-w-[32px] rounded-t-sm transition-all duration-300 z-10 ${isHovered ? 'bg-gray-700 dark:bg-gray-300' : 'bg-gray-900 dark:bg-gray-100'}`}
                  style={{ height: `${Math.max(recoveredHeight, 2)}%` }}
                ></div>
              </div>
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{point.label}</span>
            </div>
          );
        })}
      </div>
      
      <div className="flex items-center justify-center gap-6 mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-gray-900 dark:bg-gray-100"></div>
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Recovered</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-gray-100 dark:bg-gray-800"></div>
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">At Risk</span>
        </div>
      </div>
    </div>
  );
}
