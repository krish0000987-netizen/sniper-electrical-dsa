/**
 * Adapter registry — the single source of truth for what each Integration Hub
 * row can do today. Effective status is COMPUTED, never admin-fabricated:
 *
 *   excluded rows            → "not_configured" (scope out)
 *   mock mode (row config)   → "sandbox"
 *   live mode + driver       → driver probe outcome:
 *     pan_verify             → "connected" only after a passing Digitap probe
 *     every other adapter    → "awaiting_enablement" (Digitap suite not enabled)
 */

import type { AdapterDef, AdapterMode, AdapterStatus } from "./types.js";
import { CATALOG_BY_CODE } from "./types.js";
import { digitapConfig, probePanBasic } from "./digitap.js";

export interface IntegrationRow {
  id: number;
  tenant_id: number;
  code: string;
  name: string;
  category: string;
  provider: string | null;
  status: string;
  config: string | null;
}

export interface IntegrationView {
  id: number;
  code: string;
  name: string;
  category: string;
  /** last persisted status (back-compat) */
  status: string;
  /** persisted provider label (e.g. MOCK-PAN_VERIFY / DIGITAP) */
  provider: string | null;
  /** desired mode from row config: mock | live | pending */
  mode: AdapterMode;
  /** computed truth for the hub UI */
  effectiveStatus: AdapterStatus;
  scope: string;
  excluded: boolean;
  driver: string;
  digitapFamily: string | null;
  digitapProduct: string | null;
  digitapEnabled: boolean;
  needsConsent: boolean;
  credentialsConfigured: boolean;
  /** display helper */
  note: string;
}

export function parseRowConfig(row: IntegrationRow): { mode?: string; environment?: string; sandbox?: boolean; demo?: boolean; lastTest?: string; lastError?: string; lastTestOk?: boolean; lastTestMessage?: string } {
  try {
    return row.config ? JSON.parse(row.config) : {};
  } catch {
    return {};
  }
}

export function effectiveStatusOf(row: IntegrationRow, adapter: AdapterDef | undefined, credentialsConfigured: boolean): AdapterStatus {
  const cfg = parseRowConfig(row);
  const desiredMode: AdapterMode = cfg.mode === "live" ? "live" : "mock";
  if (adapter?.excluded) return "not_configured";
  if (desiredMode === "mock") return "sandbox";

  // Live mode requested →
  if (!adapter) return "error";
  if (adapter.driver === "pending" || !adapter.digitap?.enabled) return "awaiting_enablement";
  if (adapter.driver === "digitap") {
    if (adapter.code === "pan_verify") {
      // Only a PASSING live probe (persisted on the row config by the hub Test
      // endpoint) proves "connected". A failed probe → error; creds present but
      // unverified → awaiting_enablement (run Test); no creds → not_configured.
      if (cfg.lastTestOk === true) return "connected";
      if (cfg.lastTestOk === false) return "error";
      return credentialsConfigured ? "awaiting_enablement" : "not_configured";
    }
    return "awaiting_enablement";
  }
  return "sandbox";
}

export function adapterCredentialsConfigured(code: string): boolean {
  if (code === "pan_verify") return !!digitapConfig().creds;
  return false;
}

export function buildIntegrationView(row: IntegrationRow): IntegrationView {
  const adapter = CATALOG_BY_CODE.get(row.code);
  const cfg = parseRowConfig(row);
  const creds = adapterCredentialsConfigured(row.code);
  const status = effectiveStatusOf(row, adapter, creds);
  const suite = adapter?.digitap;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    status: row.status,
    provider: row.provider,
    mode: cfg.mode === "live" ? "live" : "mock",
    effectiveStatus: status,
    scope: adapter?.category ?? row.category,
    excluded: !!adapter?.excluded,
    driver: adapter?.driver ?? "pending",
    digitapFamily: suite?.family ?? null,
    digitapProduct: suite?.product ?? null,
    digitapEnabled: !!suite?.enabled,
    needsConsent: !!adapter?.needsConsent,
    credentialsConfigured: creds,
    note: cfg.lastTestMessage ?? suite?.note ?? ""
  };
}

/** Runtime guard so a mock/labelled adapter never silently impersonates live data. */
export function modeOf(row: IntegrationRow): "live" | "mock" {
  return parseRowConfig(row).mode === "live" ? "live" : "mock";
}
