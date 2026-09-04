'use client'

import React, { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface RecoveryData {
  valid: boolean
  alreadyResolved?: boolean
  merchantName?: string
  customerName?: string | null
  maskedEmail?: string | null
  amountMinor?: number
  amountFormatted?: string
  currency?: string
  reason?: string
  status?: string
  expiresAt?: string
  orderReference?: string | null
  mode?: 'audit' | 'live'
  resolutionReceipt?: {
    receiptId: string
    recoveredAt: string
    recoveredAmountFormatted: string
  } | null
  message?: string
  error?: string
}

interface ResolutionResult {
  success: boolean
  receiptId?: string
  recoveredAmountMinor?: number
  currency?: string
  recoveredAt?: string
  alreadyResolved?: boolean
  error?: string
}

export default function CustomerRecoveryPage() {
  const params = useParams()
  const token = (params?.token as string) || ''

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [data, setData] = useState<RecoveryData | null>(null)
  const [resolution, setResolution] = useState<ResolutionResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadDetails() {
      if (!token) return
      try {
        const res = await fetch(`/api/recover/${token}`)
        const json = await res.json()

        if (!active) return

        if (!res.ok && !json.alreadyResolved) {
          setData({
            valid: false,
            error: json.error || 'INVALID_LINK',
            message: json.message || 'This recovery link is invalid or expired.'
          })
        } else {
          setData(json)
          if (json.alreadyResolved && json.resolutionReceipt) {
            setResolution({
              success: true,
              receiptId: json.resolutionReceipt.receiptId,
              recoveredAt: json.resolutionReceipt.recoveredAt,
              alreadyResolved: true
            })
          }
        }
      } catch {
        if (active) {
          setErrorMessage('Failed to connect to recovery servers. Please check your connection and retry.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    loadDetails()

    return () => {
      active = false
    }
  }, [token])

  const handleResolve = async () => {
    if (!token || submitting) return
    try {
      setSubmitting(true)
      setErrorMessage(null)

      const res = await fetch(`/api/recover/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentMethod: 'CUSTOMER_SELF_SERVICE' })
      })

      const json = await res.json()

      if (!res.ok) {
        setErrorMessage(json.error || json.message || 'Payment resolution could not be completed.')
      } else {
        setResolution(json)
      }
    } catch {
      setErrorMessage('Network error during settlement. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // Loading skeleton
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-slate-200 dark:border-zinc-800 p-8 text-center">
          <div className="w-12 h-12 rounded-full border-3 border-emerald-600 border-t-transparent animate-spin mx-auto mb-4" />
          <h2 className="text-base font-semibold text-slate-800 dark:text-zinc-200">Verifying secure recovery link...</h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Authenticating cryptographic token with issuer</p>
        </div>
      </div>
    )
  }

  // Invalid / Expired state
  if (!data?.valid && !data?.alreadyResolved) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-slate-200 dark:border-zinc-800 p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
            !
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
            {data?.error === 'EXPIRED' ? 'Payment Link Expired' : 'Link Unavailable'}
          </h2>
          <p className="text-sm text-slate-600 dark:text-zinc-400 mb-6">
            {data?.message || 'This recovery link is no longer valid or has expired. Please contact the merchant to obtain an updated payment link.'}
          </p>
          <div className="p-3 bg-slate-50 dark:bg-zinc-800/50 rounded-lg text-xs text-slate-500 dark:text-zinc-400">
            For security, recovery links are single-use and time-limited.
          </div>
        </div>
      </div>
    )
  }

  // Success / Already Resolved state
  if (resolution?.success) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-slate-200 dark:border-zinc-800 p-8">
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-3 text-3xl font-bold">
              ✓
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Payment Confirmed</h1>
            <p className="text-sm text-slate-600 dark:text-zinc-400 mt-1">
              Your payment to <span className="font-semibold text-slate-800 dark:text-zinc-200">{data?.merchantName}</span> has been settled.
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-zinc-800/60 rounded-xl p-5 border border-slate-200 dark:border-zinc-700/60 space-y-3 mb-6">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 dark:text-zinc-400">Receipt Reference</span>
              <span className="font-mono font-medium text-slate-900 dark:text-white">{resolution.receiptId}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 dark:text-zinc-400">Amount Paid</span>
              <span className="font-semibold text-slate-900 dark:text-white">{data?.amountFormatted}</span>
            </div>
            {data?.customerName && (
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500 dark:text-zinc-400">Account Holder</span>
                <span className="text-slate-900 dark:text-white">{data.customerName}</span>
              </div>
            )}
            {data?.maskedEmail && (
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500 dark:text-zinc-400">Confirmation Sent To</span>
                <span className="text-slate-900 dark:text-white">{data.maskedEmail}</span>
              </div>
            )}
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 dark:text-zinc-400">Settlement Date</span>
              <span className="text-slate-900 dark:text-white">
                {resolution.recoveredAt ? new Date(resolution.recoveredAt).toLocaleString() : new Date().toLocaleString()}
              </span>
            </div>
          </div>

          <div className="text-center">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-xs font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
            >
              Print Receipt
            </button>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-200 dark:border-zinc-800 text-center text-xs text-slate-400">
            Protected by RECLAIM Automated Revenue Recovery
          </div>
        </div>
      </div>
    )
  }

  // Active Payment Resolution View
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
        {/* Header Branding */}
        <div className="bg-gradient-to-r from-slate-900 via-zinc-900 to-slate-900 p-6 text-white border-b border-zinc-800">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs uppercase tracking-wider font-semibold text-emerald-400">Secure Payment Portal</span>
            <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full text-slate-300">256-bit Encrypted</span>
          </div>
          <h1 className="text-xl font-bold">{data?.merchantName}</h1>
          <p className="text-xs text-slate-300 mt-1">Invoice Resolution Request</p>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6">
          {errorMessage && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl text-xs text-rose-700 dark:text-rose-300">
              {errorMessage}
            </div>
          )}

          {/* Mode Banner */}
          {data?.mode === 'audit' && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-xl text-xs text-amber-800 dark:text-amber-300">
              <span className="font-semibold">Audit & Safe Simulation Mode:</span> You can verify the full settlement workflow without actual card charges.
            </div>
          )}

          {/* Amount Due Card */}
          <div className="bg-slate-50 dark:bg-zinc-800/50 rounded-xl p-5 border border-slate-200 dark:border-zinc-700/60 text-center">
            <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-zinc-400">Amount Outstanding</span>
            <div className="text-3xl font-extrabold text-slate-900 dark:text-white mt-1">
              {data?.amountFormatted}
            </div>
            {data?.reason && (
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-2 max-w-sm mx-auto">
                {data.reason}
              </p>
            )}
          </div>

          {/* Details list */}
          <div className="space-y-2 text-xs">
            {data?.orderReference && (
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-zinc-800">
                <span className="text-slate-500 dark:text-zinc-400">Reference ID</span>
                <span className="font-mono text-slate-800 dark:text-zinc-200">{data.orderReference}</span>
              </div>
            )}
            {data?.customerName && (
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-zinc-800">
                <span className="text-slate-500 dark:text-zinc-400">Customer</span>
                <span className="text-slate-800 dark:text-zinc-200">{data.customerName}</span>
              </div>
            )}
            {data?.maskedEmail && (
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-zinc-800">
                <span className="text-slate-500 dark:text-zinc-400">Billed Email</span>
                <span className="text-slate-800 dark:text-zinc-200">{data.maskedEmail}</span>
              </div>
            )}
            {data?.expiresAt && (
              <div className="flex justify-between py-1.5">
                <span className="text-slate-500 dark:text-zinc-400">Link Valid Until</span>
                <span className="text-slate-800 dark:text-zinc-200">{new Date(data.expiresAt).toLocaleDateString()}</span>
              </div>
            )}
          </div>

          {/* Action Button */}
          <div>
            <button
              onClick={handleResolve}
              disabled={submitting}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white font-medium text-sm rounded-xl shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Processing Settlement...</span>
                </>
              ) : (
                <span>Complete Payment Securely</span>
              )}
            </button>
            <p className="text-[11px] text-center text-slate-400 mt-2">
              No sensitive banking or card numbers are collected on this form.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 dark:bg-zinc-950 p-4 border-t border-slate-200 dark:border-zinc-800 text-center text-[11px] text-slate-500">
          Powered by RECLAIM &bull; End-to-End Encrypted Recovery
        </div>
      </div>
    </div>
  )
}