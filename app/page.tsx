import React from 'react';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 text-center">
      <h1 className="text-6xl font-bold mb-4">RECLAIM</h1>
      <h2 className="text-3xl font-semibold mb-6">AI Revenue Recovery Agent</h2>
      <p className="text-xl mb-12">
        Find the money you're losing. Recover it automatically.
      </p>
      
      <div className="mt-8 p-4 border border-gray-300 rounded-lg bg-gray-50 dark:bg-gray-800 dark:border-gray-700">
        <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">
          Foundation setup complete.
        </p>
      </div>
    </main>
  );
}
