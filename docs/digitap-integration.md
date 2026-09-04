# SNIPER × Digitap + Supabase — Integration Hub documentation

This document describes how the SNIPER Integration Hub connects to real
provider APIs through a single **Digitap** account, with integration/compliance
records persisted to a **Supabase** project while the CRM core stays on its own
Postgres. It reflects what is **verified live**, what is **awaiting
enablement**, and exactly what must happen for each remaining adapter to go
live. Nothing in this file is fabricated: an adapter is marked Connected only
after a passing provider probe.

---

## 1. Architecture

```
Browser (React)  ──►  SNIPER API (Express, server/.env holds secrets)
                          │
                          ├── CRM core data ──► primary Postgres (DATABASE_URL)
                          │
                          ├── adapter layer (server/src/adapters)
                          │      registry → driver (digitap | mock | pending)
                          │         │
                          │         ▼
                          │   Digitap (svcdemo.digitap.work UAT / svc.digitap.ai prod)
                          │   Basic auth client_id:client_secret  ·  billable on HTTP 200
                          │
                          └── provider store (server/src/db/supabase.ts) ──► Supabase
                                 integration_state · provider_requests ·
                                 consent_records · verification_results · credit_pulls
                                 (RLS on, service-role only — see §6)
```

Digitap APIs are called **only** from the SNIPER backend. No Digitap
credential, Supabase service key, raw provider response or unmasked Aadhaar
value is ever sent to the browser.

## 2. Live status (as of this build)

| # | Hub adapter | Category | Driver | State |
|---|---|---|---|---|
| 1 | PAN Verification | Identity | Digitap PAN Basic V1/V2 | 🔌 **Wired & Test-ready** — supplied pair returns 401 on UAT valid-format probe; confirm the correct UAT pair/enablement with Digitap, then click Test |
| 2 | CKYC | Identity | pending | ⏳ Awaiting Digitap doc + enablement |
| 3 | Aadhaar / OVD | Identity | pending | ⏳ Doc held, client returns 401 — enable |
| 4–7 | CIBIL / Experian / Equifax / CRIF | Credit | pending | ⏳ Awaiting Credit Bureau suite |
| 8–10 | GSTN / MCA / Udyam | Business | pending | ⏳ Awaiting business-data suite |
| 11 | Account Aggregator | Banking | pending | ⏳ Awaiting AA (TSP/FIU) suite |
| 12 | Bank Statement Parser | Banking | pending | ⏳ Awaiting Alternate Data (BSA) suite |
| 13 | E-Sign Provider | Documents | pending | ⏳ Awaiting Onboarding (eSign) suite |
| 14 | OCR Engine | Documents | pending | ⏳ Awaiting Onboarding (OCR) suite |
| 15–20 | Payments (UPI/NACH/NEFT) + Communication (WhatsApp/SMS/Email) | — | excluded | 🚫 Out of live scope by design |

Every non-live adapter shows **Awaiting Digitap enablement** (or a probe error)
in the Hub — the UI never fabricates “Connected” and no adapter goes live
until its Test probe passes. Note: earlier session notes claimed the PAN pair
was “verified” because an invalid-format PAN returned HTTP 400 — that 400 is
returned pre-authentication (even with no credentials), so it proves nothing.
Re-probed 2026-09-04 with format-valid, doc-correct payloads: **V1 → HTTP 401
and V2 → HTTP 401 (`Client Authentication Failed`) even with DD/MM/YYYY DOB**,
i.e. the supplied pair is not (yet) accepted on UAT for PAN Basic. This is the
single item blocking the first live adapter. The driver also converts ISO DOB
to Digitap's DD/MM/YYYY format, so no further code change is needed once
Digitap confirms the correct pair.

## 3. Digitap API inventory (implemented)

Auth for every call: `authorization: Basic base64(client_id:client_secret)` +
`content-type: application/json`. Payloads always carry `client_ref_num`
(≤ 45 chars). Success responses return `result_code` 101 (valid),
102 (invalid / event), 103 (not found). **HTTP 200 = billable** — probe code
deliberately sends an invalid PAN so a probe can never bill.

### 3.1 KYC – PAN Basic Validation V1
- UAT `POST https://svcdemo.digitap.work/validation/kyc/v1/pan_basic`
- Prod `POST https://svc.digitap.ai/validation/kyc/v1/pan_basic`
- Body: `client_ref_num`, `pan` (10, pattern `^[A-Z]{3}[ABCFGHLJPTE][A-Z][0-9]{4}[A-Z]$`), `name` (opt), `name_match_method` (`fuzzy` default | `exact` | `dg_name_match`)
- Returns: `status` Active/Invalid, `name`, `pan_display_name`, `name_match`, `name_match_score`, `seeding_status`, `name_validated`

### 3.2 KYC – PAN Basic Validation V2
- `.../validation/kyc/v2/pan_basic` (same hosts)
- Body: `client_ref_num`, `pan`, `name` (required), `dob` (required, `DD/MM/YYYY` zero-padded)
- Returns: `status`, `status_code` (E = existing & valid; F/X/D/N/EA…EU event codes), `name` (Y/N), `dob` (Y/N), `seeding_status` (Y/R/NA)

SNIPER calls V2 when the customer record has a name **and** DOB, else V1 with
fuzzy name matching.

## 4. CRM field ↔ provider field mapping

| CRM concept | Actual provider field | Adapter/API |
|---|---|---|
| PAN (verified, stored) | request `pan`; response `status`/`status_code` | pan_basic V1/V2 |
| Name match | V1 `name_match`/`name_match_score`; V2 `name` flag | pan_basic V1/V2 |
| DOB match | V2 `dob` flag | pan_basic V2 |
| Aadhaar seeding | V1/V2 `seeding_status` (Y/R/NA) — **no Aadhaar number returned** | pan_basic |
| Address / email / alternate contacts | not offered by PAN Basic | — (needs PAN Details suite enablement + doc) |
| Credit score / report | not offered by the KYC suite | — (needs Credit Bureau suite doc + enablement) |

Rule from the project brief honoured here: fields Digitap cannot return are
shown as **Not Available**, never invented.

## 5. Environment variables (`server/.env`, git-ignored)

See `server/.env.example`. Key groups:

- `DATABASE_URL`, `DATABASE_SSL` — primary CRM Postgres (auto-TLS for remote hosts).
- `NEXUS_AUTH_SECRET` — stateless session signing secret (set strong in shared deploys).
- `DIGITAP_ENV` (`uat`/`prod`), `DIGITAP_UAT_CLIENT_ID/SECRET`, `DIGITAP_PROD_CLIENT_ID/SECRET`.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-only; alias `SUPABASE_SECRET_KEY` also accepted).

No real credentials are committed; `server/.gitignore` ignores env files but
keeps `.env.example`.

## 6. Supabase schema (hybrid persistence)

Apply `supabase/migrations/0001_provider_hub.sql` in the Supabase project
(SQL editor or `psql`). Tables:

- `integration_state (tenant_id, code)` PK — adapter mode + effective status + last test.
- `provider_requests` — every provider call: adapter, endpoint, refs, status, error, latency, actor.
- `consent_records` — consent ledger mirror (purpose, version, captured_by, payload).
- `verification_results` — normalized, **pre-masked** results with provider refs.
- `credit_pulls` — score/band/report availability only; raw bureau reports stored only where provider/business rules allow.

All five tables have **RLS enabled with no anon/authenticated policies** —
reachable exclusively by the service role from the SNIPER backend. All writes
from `server/src/db/supabase.ts` are best-effort (fail-open): if Supabase is
down the CRM flow continues and a warning is logged.

## 7. Consent, masking, RBAC, audit

- Consent: every provider-backed KYC call first writes the CRM `consents`
  ledger row and mirrors a `consent_records` entry to Supabase. No consent →
  no provider call.
- Masking: only masked PAN (`ABCP****4F`) and no Aadhaar value ever reach
  `verification_results` or API responses; full PAN stays only in the internal
  `customers` table like the rest of the CRM.
- RBAC: integration management requires `admin.integrations` (Super/Tenant
  admin); KYC actions require `kyc.*`; credit fetch requires `credit.fetch`.
- Audit: every mode switch, probe, and verification is appended to
  `audit_logs` with actor + outcome; provider requests are also logged to
  Supabase `provider_requests`.
- Duplicate prevention: the KYC button is disabled while a request is in
  flight; each Digitap call carries a fresh `client_ref_num`.

## 8. Error handling & retries

Digitap errors map to safe CRM messages (never raw stacks):

- 400 → invalid payload/format · 401/403 → provider auth failed · 102/103 →
  invalid/not-found PAN · network/timeout (20 s, 2 attempts) → provider
  unreachable. Retries happen only on network errors/5xx; 4xx and auth
  failures never retry. A failed live PAN check records a `failed` KYC record
  and returns HTTP 422 with a safe reason, and the application stage does not
  advance on failure.

## 9. Integration Hub UI / admin API

- `GET /api/admin/integrations` → rows with **computed** `effectiveStatus`
  (connected | sandbox | awaiting_enablement | error | not_configured),
  counts, and env summary. Admins cannot mark “Connected” manually.
- `PATCH /api/admin/integrations/:id` `{ mode: mock | live }` — switches the
  driver mode (records an audit entry).
- `POST /api/admin/integrations/:id/test` — PAN Basic probes Digitap UAT with
  a format-valid, non-existent PAN (`ZZZPE0000Z`) so no real profile is
  touched and no customer data is exposed; other adapters report their exact
  enablement state without a network call.
- Client: `client/src/pages/Integrations.tsx` renders statuses from probes,
  mode switch + Test per adapter; Payments/Communication rows are disabled and
  labelled out of scope. The LOS workspace shows “Verify PAN (Digitap)” only
  when the PAN adapter is live and connected; otherwise the clearly-labelled
  sandbox path runs.

## 10. Testing

- `npm run typecheck`, `npm run build -w client`.
- Unit tests: `npm run test -w server` (see `src/test/adapters.test.ts` —
  PAN/masking/dob utilities, catalog integrity, computed statuses, SQL
  translator). Translator notes: `date('now')`→`CURRENT_DATE`,
  `datetime('now')`→`CURRENT_TIMESTAMP`, `julianday()`→epoch-days,
  `strftime('%Y-%m'…)`→`TO_CHAR`; schema creation is serialized with a PG
  advisory lock so concurrent serverless cold starts are safe.
- Run order that matches the repo: seed once (`npm run seed -w server`) then
  run tests. Known pre-existing PG gaps in the GN module (strict `GROUP BY`,
  etc.) are unrelated to this feature and tracked separately.

## 11. Enablement checklist (your action items)

To unlock each remaining adapter, ask Digitap (account/client `07625809` UAT)
to enable the product and send its API doc — then paste the doc here and the
adapter ships in a follow-up pass:

1. **PAN Details / PAN Details Plus** — full profile (address, email, masked
   Aadhaar, father name) used by “PAN Verification” and identity enrichment.
2. **Aadhaar / OVD products** (KYC suite) — Aadhaar masking & OVD OCR.
3. **CKYC** product + doc.
4. **Credit Bureau suite** (CIBIL, Experian, Equifax, CRIF CIR) + doc.
5. **Business-data suite** (GSTN, MCA, Udyam) + doc.
6. **Account Aggregator (TSP/FIU)** suite + doc (Digitap is a certified AA TSP).
7. **Alternate Data / Bank Statement Analyzer** + doc.
8. **Onboarding suite** eSign + OCR products + doc.
9. **Correct UAT client_id/client_secret** — re-probed 2026-09-04 with
   doc-correct payloads: both `pan_basic` V1 and V2 return HTTP 401 `Client
   Authentication Failed` for the supplied pair (client `07625809`); earlier
   HTTP 400s were pre-auth payload gates and prove nothing. Ask Digitap to
   confirm the pair (it may belong to another environment/product) and that
   PAN Basic is enabled, then the hub Test will turn PAN Verification
   Connected. Keep `DIGITAP_ENV=uat` until production keys are issued for each
   product.

## 12. Deployment notes

- Local: set `DATABASE_URL` to a local Postgres (`DATABASE_SSL=false` if no
  TLS), add Digitap/Supabase keys, `npm run dev`.
- Serverless (Vercel): set every var above in the project env; schema creation
  is advisory-lock serialized; Supabase keeps provider/compliance records that
  would otherwise be lost on cold start.
- Never set Digitap or Supabase secrets in `VITE_*` client variables.
