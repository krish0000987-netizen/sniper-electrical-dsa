/**
 * Supabase provider store — the hybrid persistence layer for integration &
 * compliance data. The CRM core stays on the primary DATABASE_URL Postgres;
 * these records (consent, provider requests, verification results, credit
 * pulls, adapter state) live in the tenant's Supabase project so they survive
 * serverless cold starts.
 *
 * SECURITY MODEL: all tables created by supabase/migrations/0001_provider_hub.sql
 * have Row Level Security ENABLED with NO anon/authenticated policies — only
 * the service_role (which bypasses RLS) can read/write them. The service key
 * lives in server/.env (git-ignored) and is never sent to the browser.
 *
 * All calls fail open: when Supabase is not configured or unreachable the CRM
 * keeps working and a warning is logged. Provider verification itself is never
 * blocked on telemetry persistence.
 */

export interface ProviderStoreConfig {
  url: string;
  serviceKey: string;
}

export function supabaseConfig(): ProviderStoreConfig | null {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  return url && key ? { url: url.replace(/\/$/, ""), serviceKey: key } : null;
}

export function supabaseConfigured(): boolean {
  return !!supabaseConfig();
}

async function postJson<T>(cfg: ProviderStoreConfig, table: string, body: Record<string, unknown>): Promise<T | null> {
  const res = await fetch(`${cfg.url}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: cfg.serviceKey,
      authorization: `Bearer ${cfg.serviceKey}`,
      prefer: "return=representation"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`supabase ${table} insert HTTP ${res.status}`);
  const json = (await res.json()) as T[];
  return json[0] ?? null;
}

type Row = Record<string, unknown>;

function logWarn(ctx: string, e: unknown): void {
  // No payload/secret content — just the failure kind.
  console.warn(`[supabase:${ctx}] unavailable (${(e as Error).message}) — CRM continues on primary DB`);
}

/** One best-effort insert per call; never throws to the caller. */
async function safeInsert(table: string, body: Row): Promise<{ ok: boolean }> {
  const cfg = supabaseConfig();
  if (!cfg) return { ok: false };
  try {
    await postJson(cfg, table, body);
    return { ok: true };
  } catch (e) {
    logWarn(table, e);
    return { ok: false };
  }
}

export interface ProviderRequestRecord {
  tenant_id: number;
  customer_id?: number | null;
  application_id?: number | null;
  user_id: number;
  adapter: string;
  endpoint: string;
  request_ref?: string;
  provider_request_id?: string | null;
  status: "started" | "success" | "failed" | "sandbox";
  error_code?: string | null;
  latency_ms?: number | null;
}

export function logProviderRequest(r: ProviderRequestRecord): Promise<{ ok: boolean }> {
  return safeInsert("provider_requests", {
    ...r,
    provider_request_id: r.provider_request_id ?? null,
    error_code: r.error_code ?? null,
    latency_ms: r.latency_ms ?? null,
    created_at: new Date().toISOString()
  });
}

export interface VerificationRecord {
  tenant_id: number;
  customer_id?: number | null;
  application_id?: number | null;
  adapter: string;
  provider: string;
  status: string;
  /** normalized result — pre-masked, purpose-limited */
  result: unknown;
  provider_request_id?: string | null;
}

export function saveVerificationResult(r: VerificationRecord): Promise<{ ok: boolean }> {
  return safeInsert("verification_results", {
    tenant_id: r.tenant_id,
    customer_id: r.customer_id ?? null,
    application_id: r.application_id ?? null,
    adapter: r.adapter,
    provider: r.provider,
    status: r.status,
    result: JSON.stringify(r.result ?? {}),
    provider_request_id: r.provider_request_id ?? null,
    fetched_at: new Date().toISOString()
  });
}

export interface ConsentRecord {
  tenant_id: number;
  customer_id?: number | null;
  purpose: string;
  consent_version?: string | null;
  status: string;
  captured_by?: number | null;
  channel?: string | null;
  payload?: unknown;
}

export function saveConsentRecord(r: ConsentRecord): Promise<{ ok: boolean }> {
  return safeInsert("consent_records", {
    tenant_id: r.tenant_id,
    customer_id: r.customer_id ?? null,
    purpose: r.purpose,
    consent_version: r.consent_version ?? "1.0",
    status: r.status,
    captured_by: r.captured_by ?? null,
    channel: r.channel ?? "crm_portal",
    payload: JSON.stringify(r.payload ?? {}),
    obtained_at: new Date().toISOString()
  });
}

export interface CreditPullRecord {
  tenant_id: number;
  customer_id?: number | null;
  application_id?: number | null;
  provider: string;
  score?: number | null;
  score_band?: string | null;
  report_available: boolean;
  report_ref?: string | null;
}

export function saveCreditPull(r: CreditPullRecord): Promise<{ ok: boolean }> {
  return safeInsert("credit_pulls", {
    tenant_id: r.tenant_id,
    customer_id: r.customer_id ?? null,
    application_id: r.application_id ?? null,
    provider: r.provider,
    score: r.score ?? null,
    score_band: r.score_band ?? null,
    report_available: r.report_available,
    report_ref: r.report_ref ?? null,
    fetched_at: new Date().toISOString()
  });
}

export interface IntegrationStateRecord {
  tenant_id: number;
  code: string;
  suite?: string | null;
  product?: string | null;
  environment?: string | null;
  mode: "mock" | "live";
  effective_status: string;
  last_test_ok?: boolean | null;
  last_test_message?: string | null;
}

export async function upsertIntegrationState(r: IntegrationStateRecord): Promise<{ ok: boolean }> {
  const cfg = supabaseConfig();
  if (!cfg) return { ok: false };
  try {
    const res = await fetch(`${cfg.url}/rest/v1/integration_state`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: cfg.serviceKey,
        authorization: `Bearer ${cfg.serviceKey}`,
        prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({ ...r, updated_at: new Date().toISOString() })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true };
  } catch (e) {
    logWarn("integration_state", e);
    return { ok: false };
  }
}
