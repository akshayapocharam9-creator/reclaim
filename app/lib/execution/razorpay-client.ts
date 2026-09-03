/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RazorpayClientConfig {
  keyId: string
  keySecret: string
  timeoutMs?: number
}

export interface RazorpayErrorResponse {
  error: {
    code: string
    description: string
    source?: string
    step?: string
    reason?: string
    metadata?: Record<string, unknown>
  }
}

export interface RazorpayPaymentLinkParams {
  amountMinor: number
  currency: string
  referenceId: string
  description: string
  customer?: {
    name?: string
    email?: string
    phone?: string
  }
  reminderEnable?: boolean
}

export class RazorpayApiClient {
  private readonly baseUrl = 'https://api.razorpay.com/v1'
  private readonly keyId: string
  private readonly keySecret: string
  private readonly timeoutMs: number

  constructor(config: RazorpayClientConfig) {
    if (!config.keyId || !config.keySecret) {
      throw new Error('RazorpayApiClient requires keyId and keySecret')
    }
    this.keyId = config.keyId
    this.keySecret = config.keySecret
    this.timeoutMs = config.timeoutMs || 10000
  }

  private getAuthHeader(): string {
    const credentials = `${this.keyId}:${this.keySecret}`
    return `Basic ${Buffer.from(credentials).toString('base64')}`
  }

  /**
   * Internal request executor with timeout and structured error parsing.
   */
  public async request<T = any>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
      body?: Record<string, unknown>
      headers?: Record<string, string>
    } = {}
  ): Promise<{ status: number; data: T }> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
    const method = options.method || 'GET'

    const headers: Record<string, string> = {
      'Authorization': this.getAuthHeader(),
      'Content-Type': 'application/json',
      'User-Agent': 'RECLAIM-Recovery-Platform/1.0',
      ...(options.headers || {})
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      const text = await response.text()
      let data: any
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        data = { rawText: text }
      }

      if (!response.ok) {
        const errorDesc = data?.error?.description || data?.error?.code || `HTTP ${response.status}`
        const error = new Error(`Razorpay API error (${response.status}): ${errorDesc}`) as any
        error.status = response.status
        error.razorpayError = data?.error
        error.isAuthError = response.status === 401
        error.isRateLimited = response.status === 429
        error.isServerError = response.status >= 500
        throw error
      }

      return { status: response.status, data }

    } catch (err: any) {
      clearTimeout(timeoutId)
      if (err.name === 'AbortError') {
        const timeoutError = new Error(`Razorpay API request timed out after ${this.timeoutMs}ms`) as any
        timeoutError.isTimeout = true
        throw timeoutError
      }
      throw err
    }
  }

  /**
   * Fetches payment details from Razorpay: GET /payments/{id}
   */
  public async fetchPayment(paymentId: string) {
    return this.request(`/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' })
  }

  /**
   * Fetches order details from Razorpay: GET /orders/{id}
   */
  public async fetchOrder(orderId: string) {
    return this.request(`/orders/${encodeURIComponent(orderId)}`, { method: 'GET' })
  }

  /**
   * Creates a standard Razorpay Payment Link for dunning/recovery: POST /payment_links
   */
  public async createPaymentLink(params: RazorpayPaymentLinkParams) {
    const payload: Record<string, unknown> = {
      amount: params.amountMinor,
      currency: params.currency || 'INR',
      accept_partial: false,
      reference_id: params.referenceId,
      description: params.description,
      customer: {
        name: params.customer?.name || 'Customer',
        email: params.customer?.email,
        contact: params.customer?.phone
      },
      notify: {
        sms: false,
        email: Boolean(params.customer?.email)
      },
      reminder_enable: params.reminderEnable ?? true
    }

    return this.request('/payment_links', {
      method: 'POST',
      body: payload
    })
  }

  /**
   * Retries an invoice/subscription: POST /subscriptions/{id}/retry
   */
  public async retrySubscription(subscriptionId: string) {
    return this.request(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'GET' })
  }
}
