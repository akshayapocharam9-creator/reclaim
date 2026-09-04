# RECLAIM — AI Revenue Recovery Agent

> **Find the money you're losing. Recover it automatically.**

RECLAIM is an AI-powered revenue recovery agent for growing D2C and e-commerce merchants using Razorpay. It detects revenue leakage, identifies and prioritizes recovery opportunities, reasons about why revenue is at risk, recommends appropriate recovery actions, applies deterministic safety policies, keeps merchants in control of consequential actions, and tracks recovery outcomes.

---

## 1. RECLAIM

- **Product**: AI Revenue Recovery Agent for Razorpay e-commerce & subscription merchants.
- **Product Promise**: *"Find the money you're losing. Recover it automatically."*

---

## 2. Problem

Growing e-commerce and D2C businesses lose substantial revenue every month through:
- **Direct Payment Gateway Failures**: Transient banking timeouts, network drops, and issuer downtime during checkout.
- **Repeated Payment Failures**: Customers attempting multiple transactions that fail sequentially, leading to customer churn and friction.
- **Checkout Abandonment**: High-intent shoppers dropping off at the payment step without completing the order.
- **Recurring / Subscription Failures**: Inactive cards, expired mandates, or recurring debit rejections on recurring revenue streams.

Traditional merchant dashboards and analytics tools merely report these drops as historical numbers—telling merchants what was lost without providing the intelligence, workflows, or automated cadences needed to recover that revenue.

---

## 3. Solution

RECLAIM bridges the gap between passive reporting and active revenue resolution through an autonomous, policy-governed agent loop:

```
DETECT ──► UNDERSTAND ──► PRIORITIZE ──► RECOMMEND ──► EXPLAIN
                                                           │
MEASURE ◄─── EXECUTE ◄─── APPROVAL / POLICY ◄──────────────┘
   │
   └──► LEARN
```

1. **DETECT**: Ingests real-time payment lifecycle signals (e.g. Razorpay payment failures, order events).
2. **UNDERSTAND**: Correlates payment attempts, customer history, and failure patterns into canonical recovery opportunities.
3. **PRIORITIZE**: Scores recovery probability based on recoverable amount, urgency, and customer engagement signals.
4. **RECOMMEND**: Generates targeted deterministic recovery actions (smart retry, dunning notifications, or customer payment links).
5. **EXPLAIN**: AI synthesizes clear, human-readable executive summaries and outreach drafts explaining why revenue is at risk.
6. **APPROVAL / POLICY**: Evaluates every action against deterministic financial safety policies in PostgreSQL.
7. **EXECUTE**: Dispatches policy-approved actions via simulated or configured provider channels with cryptographic idempotency.
8. **MEASURE**: Tracks recovery throughput, confirmed recovered revenue, and dunning cadence completions.
9. **LEARN**: Updates recovery statistics and outcome logs to refine future prioritization.

---

## 4. Key Features

- **Revenue Leak Detection**: Continuous monitoring and ingestion of payment failure webhooks with cryptographic HMAC signature verification and event idempotency.
- **Recovery Opportunity Prioritization**: Algorithmic scoring that ranks opportunities by recoverable amount, likelihood of recovery, and urgency (Critical, High, Medium, Low).
- **AI Recovery Recommendations**: Advisory intelligence that proposes recovery channels, outreach strategies, and timing.
- **Explainable AI Reasoning**: Clear explanations of risk drivers and drafted customer messages without technical jargon.
- **Human-in-the-Loop Approval**: Action workflows with a dedicated Recovery Control Plane drawer allowing operators to inspect, approve, retry, or dismiss opportunities.
- **Deterministic Safety Policies**: Server-enforced rules governing execution limits, cooldown windows, attempt caps, and automation kill switches.
- **Policy Simulator**: Live interactive evaluator in the Agent view that lets merchants test how deterministic policies evaluate different transaction amounts across configurable thresholds.
- **Recovery Execution & Test Workflow**: Isolated, safe execution pipeline with strict audit logging, idempotency keys, and dead-letter protection.
- **Recovery Impact Tracking**: Real-time KPI metrics tracking total revenue at risk, total recovered revenue, recovery rate percentage, and active dunning lifecycle stages.

---

## 5. Safety & Control

RECLAIM is architected with strict safety guardrails separating intelligence from transaction execution:

- **AI is Advisory Only**: AI models synthesize risk explanations, summarize customer context, and draft communications. AI **never** executes financial transactions or overrides rules.
- **Deterministic Policy Authority**: All consequential actions are governed strictly by deterministic code and PostgreSQL policy tables.
- **Merchant in Control**: Consequential actions exceeding threshold limits require explicit human operator review and manual approval.
- **No Autonomous Real Money Movement**: RECLAIM operates in safe simulation/audit mode by default (`RECOVERY_EXECUTION_MODE="audit"`) and does not autonomously move real funds.
- **Read-Only Policy Simulator**: The built-in Policy Simulator is strictly non-mutating—it creates no database records, triggers no gateway requests, and dispatches no recovery actions.

### Verified Policy Governance Example
- **Amounts $\le$ ₹10,000**: Eligible for **AUTO_EXECUTE**, subject to policy enablement, cooldown periods, attempt caps, and priority criteria.
- **Amounts > ₹10,000**: Deterministically classified as **APPROVAL_REQUIRED**, requiring manual operator authorization before any execution can proceed.

---

## 6. Demo Example

The existing production deployment demonstrates the complete recovery lifecycle with the following verified data:

- **Revenue at Risk**: ₹7,500
- **Recovered Revenue**: ₹6,750
- **Opportunity Status**: `RECOVERED`
- **Dunning Cadence Status**: `COMPLETED`
- **Outcomes Count**: 1 confirmed recovery outcome
- **Customer**: Demo Recovery Customer

---

## 7. Technology

RECLAIM is built on a modern TypeScript stack:

- **Framework**: [Next.js 16 (App Router)](https://nextjs.org/) with React 19
- **Language**: [TypeScript 5](https://www.typescriptlang.org/)
- **Database ORM**: [Prisma ORM 5](https://www.prisma.io/)
- **Database**: PostgreSQL (Supabase)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/)
- **Runtime & Tooling**: Node.js, `tsx`, ESLint 9
- **Deployment**: [Vercel](https://vercel.com/)

---

## 8. Architecture / How It Works

```
┌────────────────────────────────────────────────────────┐
│                   MERCHANT INTERFACE                   │
│  Overview • Opportunities • Control Plane • Agent View │
└───────────┬────────────────────────────────┬───────────┘
            │                                │
            ▼                                ▼
┌───────────────────────┐        ┌───────────────────────┐
│  RECOVERY ADVISORY    │        │  DETERMINISTIC POLICY │
│  - AI Problem Summary │        │  - Amount Limits      │
│  - Outreach Drafting  │        │  - Cooldown & Caps    │
│  (Advisory Decoupled) │        │  - Kill Switch        │
└───────────────────────┘        └───────────┬───────────┘
                                             │ Authoritative
                                             ▼
                                 ┌───────────────────────┐
                                 │   EXECUTION SERVICE   │
                                 │   - Audit Simulation  │
                                 │   - Idempotency Keys  │
                                 │   - Dunning Cadence   │
                                 └───────────┬───────────┘
                                             │
                                             ▼
                                 ┌───────────────────────┐
                                 │      SUPABASE DB      │
                                 │  PostgreSQL + Prisma  │
                                 └───────────────────────┘
```

1. **Signals**: Payment failure webhooks and events arrive and are validated for HMAC signatures and tenant isolation.
2. **Opportunities**: Records are stored with structured failure evidence, amount at risk, and calculated urgency.
3. **Advisory & Policy**: The UI presents both deterministic recommendations and decoupled AI advisory intelligence. The policy engine evaluates whether the opportunity qualifies for automatic processing or mandates manual review.
4. **Action & Dunning**: Approved actions trigger dunning workflows (Day 1, Day 3, Day 7) and customer recovery tokens that lead to the customer payment resolution flow.
5. **Reconciliation**: Successful recovery transitions the opportunity to `RECOVERED`, stops further dunning cadences, and logs immutable audit records.

---

## 9. Local Development

### Prerequisites
- Node.js (v18 or v20+ recommended)
- npm (or yarn / pnpm)
- Access to a PostgreSQL database (e.g. Supabase)

### Setup Instructions

1. **Clone the repository**:
   ```bash
   git clone https://github.com/akshayapocharam9-creator/reclaim.git
   cd reclaim
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   Create a `.env` file in the project root based on `.env.example`:
   ```bash
   cp .env.example .env
   ```
   Fill in the required database connection string and session secret (placeholders documented below).

4. **Generate Prisma client**:
   ```bash
   npx prisma generate
   ```

5. **Start development server**:
   ```bash
   npm run dev
   ```

6. **Open in browser**:
   Navigate to [http://localhost:3000](http://localhost:3000)

---

## 10. Environment Variables

Reference `.env.example` for all variable names. Below is a description of required and optional environment configuration:

| Variable | Required | Purpose |
| :--- | :---: | :--- |
| `DATABASE_URL` | **Yes** | Pooled PostgreSQL connection string for Prisma. |
| `DIRECT_URL` | No | Direct PostgreSQL connection string for migrations. |
| `SESSION_SECRET` | **Yes** | Cryptographic key used to sign tenant authentication cookies (min 32 chars). |
| `RECOVERY_EXECUTION_MODE` | No | Sets execution mode: `"audit"` (safe simulation, default) or `"live"`. |
| `RAZORPAY_WEBHOOK_SECRET` | No | Secret for verifying incoming Razorpay webhook HMAC signatures. |
| `RAZORPAY_TENANT_ID` | No | Default tenant ID associated with ingested webhooks. |
| `RAZORPAY_KEY_ID` | No | Razorpay API key ID for payment operations. |
| `RAZORPAY_KEY_SECRET` | No | Razorpay API key secret for payment operations. |
| `RESEND_API_KEY` | No | API key for sending email payment reminders via Resend. |
| `EMAIL_FROM` | No | Sender address for outgoing recovery notifications. |
| `GEMINI_API_KEY` | No | API key for Gemini AI advisory explanations. |
| `OPENAI_API_KEY` | No | Alternative API key for OpenAI advisory explanations. |

> **Security Note**: Never commit actual API keys, secrets, passwords, or connection credentials to source control.

---

## 11. Production Demo

- **Live Production URL**: [https://reclaim-tau-eight.vercel.app](https://reclaim-tau-eight.vercel.app)
- **Verified Demo Opportunity**: ₹7,500 at risk, ₹6,750 recovered (`RECOVERED` status, `COMPLETED` dunning)
- **Policy Simulator**: Available on [/agent](https://reclaim-tau-eight.vercel.app/agent)

---

## 12. Project Status

RECLAIM is a working buildathon prototype featuring a deployed web application, live PostgreSQL database persistence, multi-tenant authentication, deterministic policy engine, dunning cadence workflow, and verified payment recovery pipeline.

---

## 13. Future Scope

- **Direct Razorpay App Store Integration**: One-click app marketplace installation for Razorpay merchants.
- **Omnichannel Dunning**: Expanding notification channels to WhatsApp Business API and SMS gateway integrations.
- **Adaptive Dunning Timing**: Dynamic ML-based notification scheduling optimized around customer payment habits.
- **Multi-Gateway Support**: Support for additional payment aggregators alongside Razorpay.

---

## 14. License

This repository does not currently specify an open-source license. All rights are reserved by the repository owners.
