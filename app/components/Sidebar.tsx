'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { name: 'Overview', href: '/' },
  { name: 'Opportunities', href: '/opportunities' },
  { name: 'Recoveries', href: '/recoveries' },
  { name: 'Customers', href: '/customers' },
  { name: 'Agent', href: '/agent' },
  { name: 'Integrations', href: '/integrations' },
  { name: 'Settings', href: '/settings' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-[#f9fafb] dark:bg-[#09090b] border-r border-gray-200 dark:border-gray-800 flex flex-col h-full">
      <div className="px-6 py-8">
        <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          RECLAIM
        </h1>
        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 uppercase tracking-widest font-medium">
          Revenue Agent
        </p>
      </div>

      <nav className="flex-1 px-4 space-y-0.5">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center px-3 py-2 text-sm font-medium transition-all rounded-md ${
                isActive 
                  ? 'bg-white dark:bg-[#18181b] text-gray-900 dark:text-white shadow-sm border border-gray-200 dark:border-gray-800' 
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#18181b]/50 border border-transparent'
              }`}
            >
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="p-6 mt-auto">
        <div className="flex items-center gap-3">
          <div className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </div>
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Agent Active</span>
        </div>
      </div>
    </aside>
  );
}
