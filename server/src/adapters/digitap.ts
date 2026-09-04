/**
 * Digitap API client — server-side only. Credentials never leave the process
 * environment. Implements exactly the endpoints documented in Digitap's KYC
 * Validation API Suite (UAT: svcdemo.digitap.work, prod: svc.digitap.ai):
 *   POST /validation/kyc/v1/pan_basic
 *   POST /validation/kyc/v2/pan_basic
 * Auth: HTTP Basic (client_id:client_secret). Billable only on HTTP 200.
 */

import type { AdapterResult, PanVerification } from "./types.js";

export type DigitapEnv = "uat" | "prod";

export interface DigitapCredentials {
  clientId: string;
  clientSecret: string;
}

export const PAN_REGEX = /^[A-Z]{3}[ABCFGHLJPTE][A-Z][0-9]{4}[A-Z]$/;

export function digitapConfig(): { env: DigitapEnv; creds: DigitapCredentials | null } {
  const env: DigitapEnv = process.env.DIGITAP_ENV === "prod" ? "prod" : "uat";
  const clientId = (env === "prod" ? process.env.DIGITAP_PROD_CLIENT_ID : process.env.DIGITAP_UAT_CLIENT_ID) || "";
  const clientSecret = (env === "prod" ? process.env.DIGITAP_PROD_CLIENT_SECRET : process.env.DIGITAP_UAT_CLIENT_SECRET) || "";
  const creds = clientId && clientSecret ? { clientId, clientSecret } : null;
  return { env, creds };
}

export function digitapBaseUrl(env: DigitapEnv): string {
  return env === "prod" ? "https://svc.digitap.ai" : "https://svcdemo.digitap.work";
}

export function normalizePan(pan: string): string {
  return (pan || "").trim().toUpperCase();
}

export function maskPan(pan: string): string {
  const p = normalizePan(pan);
  if (p.length !== 10) return "*****";
  return `${p.slice(0, 4)}****${p.slice(8)}`;
}

/** Normalize a DOB into Digitap's DD/MM/YYYY contract (accepts ISO + IN formats). */
export function toDigitapDob(dob: string | null | undefined): string | null {
  if (!dob) return null;
  const d = dob.trim();
  const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const ddmm = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmm) {
    const dd = ddmm[1].padStart(2, "0");
    const mm = ddmm[2].padStart(2, "0");
    return `${dd}/${mm}/${ddmm[3]}`;
  }
  return null;
}

export class DigitapError extends Error {
  httpStatus: number;
  resultCode: number | null;
  constructor(httpStatus: number, message: string, resultCode: number | null = null) {
    super(message);
    this.httpStatus = httpStatus;
    this.resultCode = resultCode;
  }
}

interface DigitapEnvelope {
  http_response_code?: number;
  client_ref_num?: string;
  request_id?: string;
  result_code?: number;
  message?: string;
  error?: string;
  result?: Record<string, any>;
}

const REQUEST_TIMEOUT_MS = 20_000;
const AUTH_ERR = "Client authentication failed";

/**
 * POST to a Digitap endpoint with Basic auth. Retried only for network errors
 * and HTTP 5xx (never on 4xx — those are never transient). Timeout 20s.
 */
async function post<T extends DigitapEnvelope = DigitapEnvelope>(
  creds: DigitapCredentials,
  path: string,
  body: Record<string, unknown>,
  attempts = 2
): Promise<{ envelope: T; httpStatus: number }> {
  const url = digitapBaseUrl(process.env.DIGITAP_ENV === "prod" ? "prod" : "uat") + path;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Basic " + Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")
        },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      const text = await res.text();
      let envelope: T;
      try {
        envelope = JSON.parse(text) as T;
      } catch {
        envelope = {} as T;
      }
      if (res.status >= 500 && attempt < attempts) {
        lastErr = new DigitapError(res.status, `Digitap temporary failure (HTTP ${res.status})`);
        continue;
      }
      return { envelope, httpStatus: res.status };
    } catch (e) {
      lastErr = e;
      if (attempt < attempts) continue;
      throw new DigitapError(0, `Digitap unreachable: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof DigitapError ? lastErr : new DigitapError(0, String(lastErr));
}

/** HTTP Basic challenge only — this never bills (no HTTP 200 with auth failure). */
function assertAuthOk(httpStatus: number, message: string | undefined): void {
  if (httpStatus === 401 || httpStatus === 403) {
    throw new DigitapError(httpStatus, message && message.toLowerCase().includes("auth") ? message : AUTH_ERR);
  }
}

export interface PanVerifyInput {
  pan: string;
  name?: string | null;
  dob?: string | null;
  /** "fuzzy" | "exact" | "dg_name_match" (V1 only) */
  nameMatchMethod?: string;
  /** V2 adds DOB match; falls back to V1 automatically when V2 is not enabled */
  v2?: boolean;
}

/**
 * Verify a PAN via Digitap PAN Basic. Maps both HTTP failures and Digitap
 * result codes (101 valid, 102 invalid/event, 103 not found) into the
 * normalized PanVerification shape.
 */
export async function panVerify(input: PanVerifyInput): Promise<{ result: PanVerification; providerRef: string }> {
  const { env, creds } = digitapConfig();
  if (!creds) throw new DigitapError(0, "Digitap credentials are not configured (DIGITAP_*_CLIENT_ID/SECRET)");
  const pan = normalizePan(input.pan);
  if (!PAN_REGEX.test(pan)) throw new DigitapError(400, "Invalid PAN format");

  const clientRef = `snpr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`.slice(0, 45);
  const useV2 = !!input.v2 && !!input.dob && !!input.name;

  let path = `/validation/kyc/v1/pan_basic`;
  let payload: Record<string, unknown> = { client_ref_num: clientRef, pan };
  if (useV2) {
    path = `/validation/kyc/v2/pan_basic`;
    // Digitap requires DOB as DD/MM/YYYY (single slash format) — the UI/CRM
    // stores ISO dates, so convert before sending.
    payload = { client_ref_num: clientRef, pan, name: input.name, dob: toDigitapDob(input.dob) ?? input.dob };
  } else if (input.name) {
    payload.name = input.name;
    if (input.nameMatchMethod) payload.name_match_method = input.nameMatchMethod;
  }

  const { envelope, httpStatus } = await post(creds, path, payload);
  assertAuthOk(httpStatus, envelope.message);
  const requestId = envelope.request_id || envelope.client_ref_num || clientRef;

  if (httpStatus === 400) throw new DigitapError(400, envelope.error || "One or more parameters format is wrong");
  if (httpStatus !== 200) {
    throw new DigitapError(httpStatus, envelope.message || envelope.error || `Digitap HTTP ${httpStatus}`);
  }

  const r = envelope.result || {};
  const resultCode = envelope.result_code;

  if (resultCode === 102) {
    throw new DigitapError(200, "Invalid ID number or combination of inputs", 102);
  }
  if (resultCode === 103) {
    throw new DigitapError(200, "No record found for the given input", 103);
  }

  if (useV2) {
    // V2: name / dob are match flags Y/N; status comes from status_code.
    const statusCode = String(r.status_code || (r.status === "Active" ? "E" : "N"));
    const active = r.status === "Active" || statusCode === "E" || statusCode.startsWith("E");
    return {
      providerRef: requestId,
      result: {
        panMasked: maskPan(pan),
        panStatus: active ? "Active" : "Invalid",
        statusCode,
        nameMatch: r.name === "Y" ? true : r.name === "N" ? false : null,
        nameMatchScore: r.name === "Y" ? 100 : r.name === "N" ? 0 : null,
        dobMatch: r.dob === "Y" ? true : r.dob === "N" ? false : null,
        seedingStatus: r.seeding_status || "",
        nameFromPan: "",
        panDisplayName: ""
      }
    };
  }

  // V1: status field is Active/Invalid; result may include name + display name.
  const active = r.status === "Active";
  const nameMatch = typeof r.name_match === "boolean" ? r.name_match : null;
  const nameScore = typeof r.name_match_score === "number" ? r.name_match_score : null;
  return {
    providerRef: requestId,
    result: {
      panMasked: maskPan(pan),
      panStatus: active ? "Active" : "Invalid",
      statusCode: active ? "E" : "N",
      nameMatch,
      nameMatchScore: nameScore,
      dobMatch: null,
      seedingStatus: r.seeding_status || "",
      nameFromPan: r.name || "",
      panDisplayName: r.pan_display_name || ""
    }
  };
}

export { AUTH_ERR };

/** Map normalized pan verification to AdapterResult used by routes + hub. */
export function panAdapterResult(pan: string, v: PanVerification, providerRef: string, latencyMs: number, env: DigitapEnv): AdapterResult {
  return {
    ok: v.panStatus === "Active",
    status: v.panStatus === "Active" ? "verified" : "invalid",
    message: v.panStatus === "Active" ? "PAN verified — active on the NSDL/ITD database" : "PAN is invalid / inactive on the ITD database",
    provider: `DIGITAP-PAN-BASIC-${env.toUpperCase()}`,
    providerRef,
    latencyMs,
    data: {
      panMasked: maskPan(pan),
      panStatus: v.panStatus,
      statusCode: v.statusCode,
      nameMatch: v.nameMatch,
      nameMatchScore: v.nameMatchScore,
      dobMatch: v.dobMatch,
      seedingStatus: v.seedingStatus,
      nameFromPan: v.nameFromPan,
      panDisplayName: v.panDisplayName
    }
  };
}

/**
 * Connection probe — verifies credentials + PAN Basic entitlement on UAT with
 * a FORMAT-VALID but non-existent PAN. The UAT demo endpoint answers 200 with
 * result_code 102/103 (never a real profile) for such PANs — the probe treats
 * that as proof of auth + product access. HTTP 401/403 = bad credentials or
 * no entitlement; 412 = feature not enabled. Never runs against production
 * unless DIGITAP_ALLOW_PROD_PROBE=true (a real billable product must first be
 * exercised through the consent flow, not a synthetic probe).
 */
export async function probePanBasic(): Promise<{ ok: boolean; message: string; latencyMs: number; auth: boolean; enabled: boolean }> {
  const { env, creds } = digitapConfig();
  const t0 = Date.now();
  if (!creds) {
    return { ok: false, message: "Digitap credentials not configured — add DIGITAP_UAT_CLIENT_ID/SECRET (or PROD) to server/.env", latencyMs: 0, auth: false, enabled: false };
  }
  if (env === "prod" && process.env.DIGITAP_ALLOW_PROD_PROBE !== "true") {
    return { ok: false, message: "Production probe disabled — exercise PAN Basic through a real consent flow instead (set DIGITAP_ALLOW_PROD_PROBE=true to override)", latencyMs: 0, auth: true, enabled: true };
  }
  try {
    // ZZZPE0000Z is format-valid (4th char P ∈ entity alphabet) but not a real PAN.
    const { envelope, httpStatus } = await post(creds, `/validation/kyc/v1/pan_basic`, { client_ref_num: `probe-${Date.now()}`, pan: "ZZZPE0000Z" }, 1);
    const latencyMs = Date.now() - t0;
    if (httpStatus === 200 && (envelope.result_code === 102 || envelope.result_code === 103)) {
      return { ok: true, message: `Digitap ${env.toUpperCase()} reachable — credentials OK, PAN Basic enabled`, latencyMs, auth: true, enabled: true };
    }
    if (httpStatus === 401 || httpStatus === 403) {
      return { ok: false, message: "Digitap authentication failed — wrong client_id/secret, or PAN Basic not enabled for this client", latencyMs, auth: false, enabled: false };
    }
    if (httpStatus === 412) {
      return { ok: false, message: "Digitap reports PAN Basic is not enabled for this client — contact your RM", latencyMs, auth: true, enabled: false };
    }
    return { ok: false, message: `Unexpected probe response (HTTP ${httpStatus}, result ${envelope.result_code ?? "—"}) — review Digitap config`, latencyMs, auth: httpStatus !== 400, enabled: false };
  } catch (e) {
    const latencyMs = Date.now() - t0;
    return { ok: false, message: `Digitap probe failed: ${(e as Error).message}`, latencyMs, auth: false, enabled: false };
  }
}
