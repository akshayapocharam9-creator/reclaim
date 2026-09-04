'use client';
import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from './Sidebar';
import HeaderAuth from './HeaderAuth';
import { useAuth } from '../context/AuthContext';
import { AppProvider } from '../context/AppContext';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const isLoginPage = pathname === '/login';
  const isPublicPage = isLoginPage || pathname === '/recover' || pathname?.startsWith('/recover/');

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isPublicPage) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, isPublicPage, router]);

  if (isPublicPage) {
    return <main className="min-h-screen">{children}</main>;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fcfcfc] dark:bg-black text-gray-400 text-xs">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin"></div>
          <span>Authenticating session...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-[#fcfcfc] dark:bg-black text-gray-900 dark:text-gray-100 overflow-hidden font-sans">
      <Sidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 border-b border-gray-200 dark:border-gray-900 bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md flex items-center justify-between px-8 shrink-0 z-10 sticky top-0">
          <h2 className="text-sm font-semibold tracking-tight text-gray-900 dark:text-white">Revenue Recovery Overview</h2>
          <HeaderAuth />
        </header>
        <main className="flex-1 overflow-y-auto p-8 bg-[#fcfcfc] dark:bg-black selection:bg-gray-200 dark:selection:bg-gray-800">
          <AppProvider>
            {children}
          </AppProvider>
        </main>
      </div>
    </div>
  );
}
