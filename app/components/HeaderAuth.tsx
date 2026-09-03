'use client';
import React from 'react';
import { useAuth } from '../context/AuthContext';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function HeaderAuth() {
  const { user, tenant, role, isAuthenticated, isLoading, signOut } = useAuth();
  const pathname = usePathname();

  if (pathname === '/login') return null;

  if (isLoading) {
    return <div className="h-6 w-32 bg-gray-200 dark:bg-gray-800 animate-pulse rounded"></div>;
  }

  if (!isAuthenticated) {
    return (
      <Link
        href="/login"
        className="px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-xs font-semibold hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
      >
        Sign In
      </Link>
    );
  }

  const getRoleBadgeColor = (userRole: string | null) => {
    switch (userRole) {
      case 'OWNER':
        return 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-800';
      case 'ADMIN':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700';
    }
  };

  return (
    <div className="flex items-center gap-4">
      <div className="text-right">
        <div className="flex items-center gap-2 justify-end">
          <span className="text-xs font-bold text-gray-900 dark:text-gray-100 tracking-tight">
            {tenant?.name || 'Organization'}
          </span>
          <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-bold tracking-wider border ${getRoleBadgeColor(role)}`}>
            {role || 'MEMBER'}
          </span>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">
          {user?.email}
        </p>
      </div>

      <button
        onClick={() => signOut()}
        className="px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 border border-gray-200 dark:border-gray-800 rounded-md hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
      >
        Sign Out
      </button>
    </div>
  );
}
