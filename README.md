# SNIPER — India's Intelligent Lending Operating System

**World-class LOS + LMS + CRM + Credit + Collections platform** — an original, independently designed lending operating system built for multi-tenant, white-label, enterprise deployment.

> **DEMO ENVIRONMENT** — all data is synthetic. Production deployment requires applicable regulatory, legal, security and integration validation. This is a compliance-*ready* architecture, not a claim of certification.

---

## Quick start

```bash
npm install          # installs server + client workspaces
npm run seed         # seeds 500 customers, 300 leads, 150 applications, 100 loans, 20 branches (idempotent)
npm run seed -- reset# wipes and reseeds the demo database
npm run dev          # starts API (http://127.0.0.1:8787) + web (http://127.0.0.1:5173)
```

Open **http://localhost:5173** and sign in with any demo account (password `demo1234`):

| Account | Role |
|---|---|
| `admin@nexus.demo` | Super Admin — full platform |
| `credit@nexus.demo` | Credit Manager — underwriting & approvals |
| `collections@nexus.demo` | Collection Manager — recovery & PTPs |
| `dsa@nexus.demo` | DSA Partner — lead & application intake |
| `sales@nexus.demo` | Sales Manager — CRM & pipeline |

## Demo journey (fully connected)

```
Lead → Customer → Application → KYC → Documents → Credit (mock bureau) → Bank & GST
→ BRE (rules engine) → Underwriting → Approval (matrix) → Sanction → KFS (APR + schedule)
→ Agreement (sandbox e-sign) → Disbursement → Loan account → EMI schedule → Payment
(allocated by policy) → Collections (DPD / PTP / tasks) → Reports → SNIPER AI
```

## Architecture

```
client/   React + TypeScript + Tailwind (premium white-first design system)
server/   Express + node:sqlite (zero native deps, deterministic lending math)
  ├── core/   finance (EMI/DPD/APR/allocation/foreclosure) · BRE · auth/RBAC · audit
  ├── db/     schema (40+ tenant-isolated tables) · demo seed engine
  └── routes/ CRM · LOS · LMS · collections · analytics · admin · compliance
```

- **Multi-tenant** — every business table carries `tenant_id`; all queries tenant-scoped.
- **Configurable engines, never hard-coded**: LOS workflow stages, BRE rules (versioned, priority-ordered, JSON ASTs), approval matrix, NPA thresholds, KFS policy, payment allocation order per product.
- **Deterministic finance** — integer math, testable amortization; schedule sums exactly to principal.
- **Financial immutability** — no historical edits; reversals/adjustments with full audit.
- **Audit everything** — who/what/when/before/after on every sensitive action (append-only).
- **Integration hub** — adapter abstraction for CIBIL/Experian/Equifax/CRIF, KYC, GST, AA, eSign, payments; every adapter in `SANDBOX` mode in the demo (no live provider queried, no external secrets).
- **SNIPER AI** — advisory analytics over live data (attention items, top overdue, lead/DSA performance, PTP watch). AI never approves or modifies records.

## Engines

| Module | What's inside |
|---|---|
| CRM | Leads (sources, scoring, probability, assignment), telecalling queue, activities, Customer 360 |
| LOS | Applications, configurable 14-stage workflow, KYC, documents w/ OCR-confidence, mock bureau + bank + GST, fraud score, BRE, underwriting workbench, approval matrix, sanction, KFS (APR, fees, amortization preview), agreement, e-sign sandbox, disbursement |
| LMS | Loan accounts, amortization schedules, DPD/NPA, payment allocation engine, charges, PTP, foreclosure quotes, restructuring, write-offs, settlements |
| Collections | Prioritized recovery queue, DPD book, agent performance, PTP kept/broken |
| Compliance | KYC ledger, consent ledger, grievance center, versioned compliance rules, KFS validation |
| Intelligence | Executive dashboard (India map), enterprise reports, risk/concentration analytics, early warning, SNIPER AI |
| Platform | RBAC (17 roles), admin (users/products/workflow/integrations), audit trail, global search (⌘K) |

## Scripts

```bash
npm run typecheck   # both workspaces
npm run build       # production client build
npm run dev:server  # API only
npm run dev:client  # web only
```

## Deploying on Vercel (demo)

The repo has two deployables (npm workspaces). Serverless hosts have a read-only
filesystem except `/tmp`, and the SQLite DB is **ephemeral there** — it is
re-provisioned from a committed demo snapshot on every cold start. That is
expected for the demo environment; persistent storage would need a hosted
Postgres instead.

- **API** — Vercel project rooted at `server/` (Express preset, entry `src/index.ts`).
  - Requires Node ≥ 22.13 for `node:sqlite`; pinned via `"engines": { "node": "22.x" }` in `server/package.json`.
  - `server/src/db/connection.ts` copies the committed demo DB (`server/demo-data/sniper.db`, ~11 MB) into `/tmp/sniper` on cold start — milliseconds, not the ~11 s reseed — and falls back to on-boot seeding if the file isn't bundled. `SNIPER_DB` always overrides.
  - Health check: `GET /api/health`.
- **Web app** — Vercel project rooted at `client/` (Vite preset, `npm run build`).
  Set `VITE_API_BASE` to the API origin (e.g. `https://loanserver.vercel.app`) so the
  built app calls the hosted API; leave it unset locally (Vite proxies `/api` → `:8787`).

## Notes

- SQLite database lives at `server/data/sniper.db` (WAL mode). Reset anytime with `npm run seed -- reset`.
- The ambient `PORT` env var is ignored; the API uses `SNIPER_PORT` (default 8787).
- **Not built on** Fineract, Mifos, FinStack or any other open-source LOS/LMS — the domain model, workflows, engines, UI and APIs are independently designed for SNIPER.
