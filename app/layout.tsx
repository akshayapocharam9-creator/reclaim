import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "./components/Sidebar";

import { AppProvider } from "./context/AppContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RECLAIM | AI Revenue Recovery Agent",
  description: "Identify and recover lost revenue automatically with AI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex h-full bg-[#fcfcfc] dark:bg-black text-gray-900 dark:text-gray-100 overflow-hidden font-sans">
        <Sidebar />
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <header className="h-16 border-b border-gray-200 dark:border-gray-900 bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md flex items-center justify-between px-8 shrink-0 z-10 sticky top-0">
            <h2 className="text-sm font-semibold tracking-tight text-gray-900 dark:text-white">Revenue Recovery Overview</h2>
            <div className="flex items-center gap-5">
              <button disabled title="Notifications coming soon" className="text-gray-300 dark:text-gray-700 cursor-not-allowed">
                <span className="sr-only">Notifications (Coming Soon)</span>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>
              </button>
              <div title="Profile settings coming soon" className="w-7 h-7 bg-gray-200 dark:bg-gray-800 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400 font-bold text-[10px] shadow-sm cursor-not-allowed">
                AE
              </div>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-8 bg-[#fcfcfc] dark:bg-black selection:bg-gray-200 dark:selection:bg-gray-800">
            <AppProvider>
              {children}
            </AppProvider>
          </main>
        </div>
      </body>
    </html>
  );
}
