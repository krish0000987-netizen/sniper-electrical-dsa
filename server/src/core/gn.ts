import { q, q1, run } from "../db/connection.js";

/* ---------- Loan status engine (Growth Nations distribution pipeline) ---------- */

export const GN_STATUS: { slug: string; label: string; group: string }[] = [
  { slug: "lead_new", label: "New Lead", group: "lead" },
  { slug: "lead_contacted", label: "Contacted", group: "lead" },
  { slug: "lead_qualified", label: "Qualified", group: "lead" },
  { slug: "lead_requirement", label: "Requirement Identified", group: "lead" },
  { slug: "app_created", label: "Application Created", group: "application" },
  { slug: "kyc_pending", label: "KYC Pending", group: "application" },
  { slug: "kyc_complete", label: "KYC Complete", group: "application" },
  { slug: "docs_pending", label: "Documents Pending", group: "application" },
  { slug: "docs_complete", label: "Documents Complete", group: "application" },
  { slug: "lender_selected", label: "Lender Selected", group: "application" },
  { slug: "ready_submission", label: "Ready for Submission", group: "application" },
  { slug: "submitted", label: "Application Submitted", group: "lender" },
  { slug: "uw", label: "Underwriting", group: "lender" },
  { slug: "query", label: "Query Raised", group: "lender" },
  { slug: "addl_docs", label: "Additional Documents Required", group: "lender" },
  { slug: "on_hold", label: "On Hold", group: "lender" },
  { slug: "approved", label: "Approved", group: "lender" },
  { slug: "rejected", label: "Rejected", group: "lender" },
  { slug: "sanction_generated", label: "Sanction Letter Generated", group: "agreement" },
  { slug: "agreement_pending", label: "Agreement Pending", group: "agreement" },
  { slug: "esign_pending", label: "eSign Pending", group: "agreement" },
  { slug: "agreement_completed", label: "Agreement Completed", group: "agreement" },
  { slug: "disb_pending", label: "Disbursement Pending", group: "disbursement" },
  { slug: "disb_initiated", label: "Disbursement Triggered by Lender", group: "disbursement" },
  { slug: "disb_partial", label: "Partially Disbursed", group: "disbursement" },
  { slug: "disb_fully", label: "Fully Disbursed", group: "disbursement" },
  { slug: "disb_failed", label: "Disbursement Failed", group: "disbursement" },
  { slug: "disb_confirmed", label: "Disbursement Confirmed", group: "completed" },
  { slug: "crm_updated", label: "Growth Nations CRM Updated", group: "completed" },
  { slug: "commission_reconciled", label: "Commission / Payout Reconciliation", group: "completed" },
  { slug: "payout_pending", label: "Payout Pending", group: "completed" },
  { slug: "payout_received", label: "Payout Received", group: "completed" },
  { slug: "closed", label: "Closed", group: "closed" }
];

const FLOW = GN_STATUS.map((s) => s.slug);
export const gnStatusIndex = (slug: string) => Math.max(0, FLOW.indexOf(slug));
export const gnStatusLabel = (slug: string) => GN_STATUS.find((s) => s.slug === slug)?.label ?? slug;
export const gnStatusGroup = (slug: string) => GN_STATUS.find((s) => s.slug === slug)?.group ?? "application";

export const GN_STAGE_LABELS: Record<string, string> = {
  lead: "Lead", application: "Application", lender: "Lender", agreement: "Agreement",
  disbursement: "Disbursement", completed: "Completed", closed: "Closed"
};

/* ---------- The canonical loan distribution workflow (as presented to stakeholders) ---------- */

export const GN_WORKFLOW: { step: number; label: string; status: string; hint: string }[] = [
  { step: 1, label: "Application Created", status: "app_created", hint: "Application logged with borrower details" },
  { step: 2, label: "KYC Complete", status: "kyc_complete", hint: "Identity & KYC documents verified" },
  { step: 3, label: "Documents Complete", status: "docs_complete", hint: "All lender-required documents collected" },
  { step: 4, label: "Lender Selected", status: "lender_selected", hint: "Eligible lender & scheme shortlisted" },
  { step: 5, label: "Application Submitted", status: "submitted", hint: "File submitted to the lender" },
  { step: 6, label: "Underwriting", status: "uw", hint: "Lender credit assessment in progress" },
  { step: 7, label: "Approved", status: "approved", hint: "Sanction approved by the lender" },
  { step: 8, label: "Agreement / eSign Complete", status: "agreement_completed", hint: "Loan agreement & eSign executed" },
  { step: 9, label: "Disbursement Triggered by Lender", status: "disb_initiated", hint: "Lender initiates fund transfer" },
  { step: 10, label: "₹ Funds → Borrower's Bank Account", status: "disb_fully", hint: "Money transferred directly by lender to the borrower's bank account" },
  { step: 11, label: "Disbursement Confirmation", status: "disb_confirmed", hint: "Lender confirms disbursement via API / webhook" },
  { step: 12, label: "Growth Nations CRM Updated", status: "crm_updated", hint: "CRM automatically updated with disbursement" },
  { step: 13, label: "Commission / Payout Reconciliation", status: "commission_reconciled", hint: "Commission calculated & payout tracked" }
];

export const gnWorkflowStep = (slug: string) => GN_WORKFLOW.find((w) => w.status === slug)?.step ?? null;

/* ---------- Commission math ---------- */

export interface CommissionResult {
  rate: number;
  gross: number;
  gst: number;
  tds: number;
  net: number;
}

/** Tax/GST rates — configurable per tenant via system_config gn_settings. */
export async function gnSettings(tenantId: number) {
  const row = await q1<{ value: string }>("SELECT value FROM system_config WHERE tenant_id = ? AND key = 'gn_settings'", [tenantId]);
  const base = { tds_pct: 2, gst_pct: 18, partner_split_pct: 60 };
  if (!row) return base;
  try { return { ...base, ...JSON.parse(row.value) }; } catch { return base; }
}

/** Compute gross/GST/TDS/net for a disbursement at a commission rate. */
export function computeCommission(disbursed: number, rate: number, settings: { tds_pct: number; gst_pct: number }): CommissionResult {
  const gross = Math.round((disbursed * rate) / 100);
  const gst = Math.round((gross * settings.gst_pct) / 100);
  const tds = Math.round((gross * settings.tds_pct) / 100);
  return { rate, gross, gst, tds, net: gross + gst - tds };
}

/** Effective rate for an application: scheme rate (or slab lookup) else product payout. */
export function effectiveRate(app: Record<string, any>): number {
  if (app.scheme_rate != null && app.scheme_rate > 0) return Number(app.scheme_rate);
  return Number(app.product_payout ?? app.commission_rate ?? 0);
}

/* ---------- Reference generators ---------- */

export async function gnRef(tenantId: number) {
  const year = new Date().getFullYear();
  const n = ((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM gn_applications WHERE tenant_id = ?", [tenantId]))?.n ?? 0) + 1;
  return `GN-${year}-${String(10000 + n)}`;
}

export async function batchRef(tenantId: number) {
  const year = new Date().getFullYear();
  const n = ((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM gn_payout_batches WHERE tenant_id = ?", [tenantId]))?.n ?? 0) + 1;
  return `PB-${year}-${String(1000 + n)}`;
}

/* ---------- Timeline + notifications ---------- */

export async function gnTimeline(tenantId: number, appId: number, event: string, note: string | null, actor: number | null) {
  await run(
    "INSERT INTO gn_application_timeline (tenant_id, app_id, event, note, actor) VALUES (?, ?, ?, ?, ?)",
    [tenantId, appId, event, note, actor]
  );
}

export async function gnNotify(tenantId: number, userId: number | null, title: string, body: string) {
  await run("INSERT INTO notifications (tenant_id, user_id, kind, title, body) VALUES (?, ?, 'inapp', ?, ?)", [tenantId, userId, title, body]);
}

/* ================== Configurable Roles & Permissions ================== */

/** Modules & actions exposed in the Roles & Permissions grid (mirrors the reference product). */
export const GN_MODULES = ["Leads", "Applications", "Sanction", "Disbursement", "Commission", "Payouts", "Documents", "Tasks", "Masters", "Finance", "HR", "Marketing", "Inbox", "Documentation", "Help", "Change Log", "Recycle Bin", "Reports", "Settings", "Command Center", "Bulk", "API Center", "Utility"] as const;
export const GN_ACTIONS = ["view", "create", "edit", "delete", "manage", "use"] as const;

export const GN_PERM_PREFIX: Record<string, string> = {
  Leads: "gn.leads", Applications: "gn.applications", Sanction: "gn.sanction", Disbursement: "gn.disbursement",
  Commission: "gn.commission", Payouts: "gn.payout", Documents: "gn.documents", Tasks: "gn.tasks",
  Masters: "gn.masters", Finance: "gn.finance", HR: "gn.hr", Marketing: "gn.marketing",
  Inbox: "gn.inbox", Documentation: "gn.docs", Help: "gn.help", "Change Log": "gn.changelog", "Recycle Bin": "gn.trash",
  Reports: "gn.reports", Settings: "gn.settings",
  "Command Center": "gn.co", Bulk: "gn.bulk", "API Center": "gn.api", Utility: "gn.utility"
};

/** Modules whose permissions are NOT covered by the gn.view umbrella — only roles explicitly granted these modules may access them. */
export const GN_LOCKED_MODULES = ["gn.co.", "gn.bulk.", "gn.api."];

/** Grid permission string for a module+action, e.g. gn.leads.view */
export function gnPerm(module: string, action: string): string {
  return `${GN_PERM_PREFIX[module] ?? "gn." + module.toLowerCase()}.${action}`;
}

/**
 * Whether a built-in role grants a perm (used to seed sensible grid defaults).
 * Maps the legacy NEXUS permission vocabulary (leads.view, applications.*, gn.view, gn.*)
 * onto the granular GN grid vocabulary (gn.leads.view, gn.applications.view, …).
 */
export function builtinGrants(role: string, perm: string): boolean {
  const list = ROLES[role] ?? [];
  for (const p of list) {
    if (p === "*") return true;
    if (p === perm) return true;
    if (p.endsWith(".*") && perm.startsWith(p.slice(0, -1))) return true;
    // legacy → GN module mapping, e.g. leads.edit grants gn.leads.edit
    const m = /^gn\.([a-z]+)\.(.+)$/.exec(perm);
    if (m) {
      const legacy = `${m[1]}.${m[2]}`;
      if (p === legacy) return true;
      if (p === `${m[1]}.*`) return true;
    }
  }
  return false;
}

/* Short-TTL cache so the middleware doesn't hit SQLite on every request */
const permCache = new Map<string, { at: number; perms: Set<string>; scopes: Map<string, string>; roleRow: ResolvedPerms["roleRow"] }>();
const PERM_TTL_MS = 15000;

export function clearPermCache(tenantId?: number) {
  if (tenantId !== undefined) {
    for (const k of Array.from(permCache.keys())) if (k.startsWith(`${tenantId}:`)) permCache.delete(k);
  } else {
    permCache.clear();
  }
}

export interface ResolvedPerms {
  perms: Set<string>;
  scopes: Map<string, string>; // grid perm -> scope ('all' | 'own')
  roleRow: { id: number; name: string; kind: string; designation: string | null; partner_type: string | null; is_system: number } | null;
}

/**
 * Resolve the effective permissions for (tenant, role).
 * - No gn_roles row          → built-in ROLES defaults.
 * - System role, no rows     → built-in defaults (fallback).
 * - Custom/system role WITH grid rows → the grid is authoritative (admin toggles).
 */
export async function resolveRolePerms(tenantId: number, role: string) {
  const key = `${tenantId}:${role}`;
  const cached = permCache.get(key);
  if (cached && Date.now() - cached.at < PERM_TTL_MS) {
    return { perms: cached.perms, scopes: cached.scopes, roleRow: cached.roleRow };
  }
  const roleRow = await q1<{ id: number; name: string; kind: string; designation: string | null; partner_type: string | null; is_system: number }>(
    "SELECT id, name, kind, designation, partner_type, is_system FROM gn_roles WHERE tenant_id = ? AND code = ?", [tenantId, role]
  );
  let perms: Set<string>;
  let scopes = new Map<string, string>();
  if (roleRow) {
    const rows = await q<{ module: string; action: string; scope: string; allowed: number }>(
      "SELECT module, action, scope, allowed FROM gn_role_permissions WHERE tenant_id = ? AND role_id = ?", [tenantId, roleRow.id]
    );
    if (rows.length > 0) {
      perms = new Set();
      for (const r of rows) {
        const p = gnPerm(r.module, r.action);
        if (r.allowed) {
          perms.add(p);
          scopes.set(p, r.scope);
        }
      }
    } else {
      perms = new Set(ROLES[role] ?? []);
    }
  } else {
    perms = new Set(ROLES[role] ?? []);
  }
  const out: ResolvedPerms = { perms, scopes, roleRow: roleRow ?? null };
  permCache.set(key, { at: Date.now(), perms, scopes, roleRow: roleRow ?? null });
  return out;
}

/**
 * DB-backed permission check used by the middleware.
 * The grid stores granular per-module perms (gn.<module>.<action>); umbrella perms
 * (gn.view / gn.*) that existing routes rely on are derived from the grid so that
 * admin-toggled roles keep working end-to-end.
 */
export async function hasGnPerm(tenantId: number, role: string, perm: string) {
  const { perms } = await resolveRolePerms(tenantId, role);
  const locked = GN_LOCKED_MODULES.some((x) => perm.startsWith(x));
  for (const p of perms) {
    if (p === "*") return true;
    if (p === perm) return true;
    if (p.endsWith(".*") && perm.startsWith(p.slice(0, -1))) return true;
    // The gn.view umbrella grants general GN pages, but NEVER the locked command-center modules
    // (Command Center / Bulk / API Center) — those need explicit role grants.
    if (p === "gn.view" && perm.startsWith("gn.") && !locked) return true;
    // Module-manage implies every granular action in that module (e.g. gn.bulk.manage grants gn.bulk.process/export/retry).
    const m = /^gn\.([a-z]+)\.([a-z_]+)$/.exec(perm);
    if (m && (p === `gn.${m[1]}.manage` || p === `gn.${m[1]}.*`)) return true;
  }
  // Grid-backed roles: any granted GN access implies GN visibility.
  if (perm === "gn.view") return Array.from(perms).some((p) => p.startsWith("gn."));
  // Master-write umbrella used by create/update endpoints — granted when the role
  // holds an admin-level action (manage/use/delete) on any module.
  if (perm === "gn.*") return Array.from(perms).some((p) => /^gn\.[a-z]+\.(manage|use|delete)$/.test(p));
  // Module umbrella, e.g. gn.finance.*
  if (perm.endsWith(".*")) {
    const prefix = perm.slice(0, -1);
    return Array.from(perms).some((p) => p.startsWith(prefix));
  }
  return false;
}

/** Explicit default grants for the locked command-center modules (Command Center / Bulk / API Center). */
export const GN_NEW_MODULE_DEFAULTS: Record<string, Record<string, string[]>> = {
  "Command Center": {
    view: ["super_admin", "tenant_admin", "branch_admin", "sales_manager", "telecaller", "field_executive", "credit_analyst", "credit_manager", "underwriter", "operations", "collection_manager", "compliance_officer", "finance", "customer_support"],
    create: ["super_admin", "tenant_admin", "branch_admin", "sales_manager", "field_executive", "credit_manager", "operations", "finance"],
    edit: ["super_admin", "tenant_admin", "branch_admin", "sales_manager", "credit_analyst", "credit_manager", "underwriter", "operations", "collection_manager", "finance"],
    manage: ["super_admin", "tenant_admin", "branch_admin", "credit_manager", "operations", "finance"]
  },
  Bulk: {
    view: ["super_admin", "tenant_admin", "branch_admin", "sales_manager", "operations", "credit_manager", "finance"],
    create: ["super_admin", "tenant_admin", "branch_admin", "sales_manager", "operations"],
    edit: ["super_admin", "tenant_admin", "branch_admin", "operations", "credit_manager"],
    manage: ["super_admin", "tenant_admin", "branch_admin", "operations"]
  },
  "API Center": {
    view: ["super_admin", "tenant_admin", "compliance_officer", "auditor", "finance"],
    create: ["super_admin", "tenant_admin", "finance"],
    edit: ["super_admin", "tenant_admin", "finance"],
    manage: ["super_admin", "tenant_admin", "finance"]
  },
  Utility: {
    view: ["super_admin", "tenant_admin", "branch_admin", "sales_manager", "credit_manager", "underwriter", "operations", "collection_manager", "compliance_officer", "finance", "customer_support", "auditor"],
    create: ["super_admin", "tenant_admin", "branch_admin", "sales_manager", "operations"],
    edit: ["super_admin", "tenant_admin", "branch_admin", "operations"],
    manage: ["super_admin", "tenant_admin", "branch_admin", "operations"]
  }
};

/** Seed the full permission grid for a role from its built-in defaults. */
export async function seedRolePermissions(tenantId: number, roleCode: string) {
  const roleRow = await q1<{ id: number }>("SELECT id FROM gn_roles WHERE tenant_id = ? AND code = ?", [tenantId, roleCode]);
  if (!roleRow) return;
  for (const m of GN_MODULES) {
    for (const a of GN_ACTIONS) {
      const p = gnPerm(m, a);
      let allowed = builtinGrants(roleCode, p) || builtinGrants(roleCode, "gn.*") ? 1 : 0;
      if (!allowed) {
        const defaults = GN_NEW_MODULE_DEFAULTS[m]?.[a] ?? [];
        if (defaults.includes(roleCode)) allowed = 1;
      }
      await run(
        "INSERT OR REPLACE INTO gn_role_permissions (tenant_id, role_id, module, action, scope, allowed) VALUES (?, ?, ?, ?, 'all', ?)",
        [tenantId, roleRow.id, m, a, allowed]
      );
    }
  }
}

// import ROLES lazily to avoid a circular import at module top
import { ROLES } from "./auth.js";
