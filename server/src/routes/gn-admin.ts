import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import * as XLSX from "xlsx";
import { q, q1, run, tx } from "../db/connection.js";
import { audit } from "../core/audit.js";
import { asyncH, authRequired, clientIp, requirePerm, type AuthedRequest } from "../middleware.js";
import {
  GN_MODULES, GN_ACTIONS, gnPerm, resolveRolePerms, clearPermCache, gnSettings,
  computeCommission, GN_STATUS
} from "../core/gn.js";
import { ROLE_LABELS } from "../core/auth.js";

export const gnAdminRouter = Router();
gnAdminRouter.use(authRequired);

const T = (req: AuthedRequest) => req.user!.tenant_id;

/* ================= CURRENT USER + RESOLVED PERMISSIONS ================= */

gnAdminRouter.get("/gn/admin/me", asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const { perms, scopes, roleRow } = await resolveRolePerms(t, req.user!.role);
  const roleName = roleRow?.name ?? ROLE_LABELS[req.user!.role] ?? req.user!.role;
  const kind = roleRow?.kind ?? "staff";
  res.json({
    user: { id: req.user!.id, name: req.user!.name, email: req.user!.email, role: req.user!.role },
    role: req.user!.role, roleName, kind,
    designation: roleRow?.designation ?? null, partner_type: roleRow?.partner_type ?? null,
    isSystem: roleRow?.is_system === 1,
    perms: Array.from(perms).sort(),
    scopes: Object.fromEntries(scopes)
  });
}));

/* ================= ROLES ================= */

gnAdminRouter.get("/gn/admin/roles", requirePerm("gn.settings.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const roles = await q<Record<string, any>>(
    `SELECT r.*,
       (SELECT COUNT(*) FROM gn_role_permissions rp WHERE rp.role_id = r.id AND rp.allowed = 1) AS allowed_perms,
       (SELECT COUNT(*) FROM users u WHERE u.role = r.code AND u.tenant_id = r.tenant_id) AS users
     FROM gn_roles r WHERE r.tenant_id = ? ORDER BY r.is_system DESC, r.name`, [t]);
  const staffRoles = roles.filter((r) => r.kind === "staff");
  const partnerRoles = roles.filter((r) => r.kind === "partner");
  res.json({ roles, staffRoles, partnerRoles, modules: GN_MODULES, actions: GN_ACTIONS });
}));

const roleSchema = z.object({
  name: z.string().min(2), code: z.string().regex(/^[a-z0-9_]+$/).optional(),
  kind: z.enum(["staff", "partner"]).optional(), designation: z.string().nullable().optional(),
  partner_type: z.string().nullable().optional()
});

gnAdminRouter.post("/gn/admin/roles", requirePerm("gn.settings.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const b = roleSchema.parse(req.body);
  let code = b.code ?? b.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const exists = await q1("SELECT id FROM gn_roles WHERE tenant_id = ? AND code = ?", [t, code]);
  if (exists) code = `${code}_${Math.floor(Math.random() * 9000 + 1000)}`;
  const id = (await run(
    "INSERT INTO gn_roles (tenant_id, code, name, kind, designation, partner_type, is_system) VALUES (?, ?, ?, ?, ?, ?, 0)",
    [t, code, b.name, b.kind ?? "staff", b.designation ?? null, b.partner_type ?? null]
  )).lastId;
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.role.create", entityType: "gn_role", entityId: id, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_roles WHERE id = ?", [id]));
}));

gnAdminRouter.patch("/gn/admin/roles/:id", requirePerm("gn.settings.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const b = roleSchema.partial().parse(req.body);
  const before = await q1("SELECT * FROM gn_roles WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!before) { res.status(404).json({ error: "Role not found" }); return; }
  if (before.is_system) {
    const allowed = ["name", "designation", "partner_type"];
    for (const k of Object.keys(b)) if (!allowed.includes(k)) delete (b as any)[k];
  }
  if (Object.keys(b).length === 0) { res.json(before); return; }
  const sets = Object.keys(b).map((k) => `${k} = ?`);
  await run(`UPDATE gn_roles SET ${sets.join(", ")} WHERE id = ?`, [...Object.values(b), before.id]);
  clearPermCache(t);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.role.update", entityType: "gn_role", entityId: before.id, before, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_roles WHERE id = ?", [before.id]));
}));

gnAdminRouter.delete("/gn/admin/roles/:id", requirePerm("gn.settings.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const before = await q1<{ id: number; is_system: number }>("SELECT id, is_system FROM gn_roles WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!before) { res.status(404).json({ error: "Role not found" }); return; }
  if (before.is_system) { res.status(400).json({ error: "System roles cannot be deleted" }); return; }
  await run("DELETE FROM gn_role_permissions WHERE role_id = ?", [before.id]);
  await run("DELETE FROM gn_roles WHERE id = ?", [before.id]);
  clearPermCache(t);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.role.delete", entityType: "gn_role", entityId: before.id, ip: clientIp(req) });
  res.json({ ok: true });
}));

/* ================= PERMISSION GRID ================= */

gnAdminRouter.get("/gn/admin/roles/:id/permissions", requirePerm("gn.settings.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const role = await q1("SELECT * FROM gn_roles WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!role) { res.status(404).json({ error: "Role not found" }); return; }
  const rows = await q<Record<string, any>>(
    "SELECT module, action, scope, allowed FROM gn_role_permissions WHERE role_id = ?", [role.id]);
  const grid: Record<string, Record<string, { allowed: boolean; scope: string }>> = {};
  for (const m of GN_MODULES) {
    grid[m] = {};
    for (const a of GN_ACTIONS) {
      const row = rows.find((r) => r.module === m && r.action === a);
      grid[m][a] = row ? { allowed: !!row.allowed, scope: row.scope } : { allowed: false, scope: "all" };
    }
  }
  res.json({ role, grid, modules: GN_MODULES, actions: GN_ACTIONS });
}));

const gridSaveSchema = z.object({
  rows: z.array(z.object({ module: z.string(), action: z.string(), allowed: z.boolean(), scope: z.enum(["all", "own"]).optional() }))
});

gnAdminRouter.post("/gn/admin/roles/:id/permissions", requirePerm("gn.settings.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const role = await q1<{ id: number; code: string }>("SELECT id, code FROM gn_roles WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!role) { res.status(404).json({ error: "Role not found" }); return; }
  const b = gridSaveSchema.parse(req.body);
  await tx(async () => {
    await run("DELETE FROM gn_role_permissions WHERE role_id = ?", [role.id]);
    for (const r of b.rows) {
      await run(
        "INSERT INTO gn_role_permissions (tenant_id, role_id, module, action, scope, allowed) VALUES (?, ?, ?, ?, ?, ?)",
        [t, role.id, r.module, r.action, r.scope ?? "all", r.allowed ? 1 : 0]
      );
    }
  });
  clearPermCache(t);
  const granted = b.rows.filter((r) => r.allowed).length;
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.role.permissions.save", entityType: "gn_role", entityId: role.id, after: { role: role.code, granted }, ip: clientIp(req) });
  res.json({ ok: true, granted });
}));

/* ================= SETTINGS ================= */

const SETTING_KEYS = ["gn_company", "gn_api_keys", "gn_leave_types", "gn_holidays", "gn_office_timings", "gn_reseller", "gn_settings", "gn_bank"] as const;

gnAdminRouter.get("/gn/admin/settings", requirePerm("gn.settings.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const rows = await q<{ key: string; value: string }>("SELECT key, value FROM system_config WHERE tenant_id = ? AND key IN (" + SETTING_KEYS.map(() => "?").join(",") + ")", [t, ...SETTING_KEYS]);
  const out: Record<string, any> = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  res.json({
    keys: SETTING_KEYS,
    ...out,
    gn_roles_count: ((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM gn_roles WHERE tenant_id = ?", [t]))?.n ?? 0)
  });
}));

const settingSaveSchema = z.object({
  key: z.enum(SETTING_KEYS),
  value: z.any()
});

gnAdminRouter.post("/gn/admin/settings", requirePerm("gn.settings.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const b = settingSaveSchema.parse(req.body);
  const before = await q1("SELECT value FROM system_config WHERE tenant_id = ? AND key = ?", [t, b.key]);
  await run("INSERT OR REPLACE INTO system_config (tenant_id, key, value) VALUES (?, ?, ?)", [t, b.key, JSON.stringify(b.value)]);
  await audit({ tenantId: t, userId: req.user!.id, action: `gn.settings.${b.key}.save`, entityType: "system_config", before: before ? { value: before.value } : null, after: { value: b.value }, ip: clientIp(req) });
  res.json({ ok: true, key: b.key });
}));

/* ================= API KEYS ================= */

gnAdminRouter.get("/gn/admin/api-keys", requirePerm("gn.settings.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const row = await q1<{ value: string }>("SELECT value FROM system_config WHERE tenant_id = ? AND key = 'gn_api_keys'", [t]);
  let keys: any[] = [];
  try { keys = row ? JSON.parse(row.value) : []; } catch { keys = []; }
  res.json(keys.map((k) => ({ ...k, key: k.key ? `${k.key.slice(0, 6)}••••••${k.key.slice(-4)}` : null })));
}));

gnAdminRouter.post("/gn/admin/api-keys", requirePerm("gn.settings.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const b = z.object({ label: z.string().min(2) }).parse(req.body);
  const row = await q1<{ value: string }>("SELECT value FROM system_config WHERE tenant_id = ? AND key = 'gn_api_keys'", [t]);
  let keys: any[] = [];
  try { keys = row ? JSON.parse(row.value) : []; } catch { keys = []; }
  const plain = `gn_live_${randomBytes(16).toString("hex")}`;
  keys.unshift({ id: Date.now(), label: b.label, key: plain, created_at: new Date().toISOString(), status: "active", last_used: null });
  await run("INSERT OR REPLACE INTO system_config (tenant_id, key, value) VALUES (?, 'gn_api_keys', ?)", [t, JSON.stringify(keys)]);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.api_key.create", entityType: "system_config", after: { label: b.label }, ip: clientIp(req) });
  res.json({ ok: true, key: plain, label: b.label });
}));

gnAdminRouter.delete("/gn/admin/api-keys/:id", requirePerm("gn.settings.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const row = await q1<{ value: string }>("SELECT value FROM system_config WHERE tenant_id = ? AND key = 'gn_api_keys'", [t]);
  let keys: any[] = [];
  try { keys = row ? JSON.parse(row.value) : []; } catch { keys = []; }
  const id = Number(req.params.id);
  keys = keys.filter((k) => k.id !== id);
  await run("INSERT OR REPLACE INTO system_config (tenant_id, key, value) VALUES (?, 'gn_api_keys', ?)", [t, JSON.stringify(keys)]);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.api_key.revoke", entityType: "system_config", entityId: id, ip: clientIp(req) });
  res.json({ ok: true });
}));

/* ================= START FRESH (demo reset of GN transactional data) ================= */

gnAdminRouter.post("/gn/admin/start-fresh", requirePerm("gn.settings.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const tables = ["gn_webhook_events", "gn_api_logs", "gn_bulk_errors", "gn_bulk_jobs", "gn_bulk_rows", "gn_bulk_batches",
    "gn_payouts", "gn_disbursements", "gn_agreements", "gn_sanctions", "gn_lender_matches", "gn_credit_profiles", "gn_kyc", "gn_consents",
    "gn_applicant_events", "gn_applicants",
    "gn_documents", "gn_campaigns", "gn_candidates", "gn_payroll", "gn_attendance", "gn_leave_requests",
    "gn_expenses", "gn_customer_fees", "gn_payout_batches", "gn_commissions", "gn_application_timeline", "gn_applications", "gn_tasks"];
  const counts: Record<string, number> = {};
  for (const tbl of tables) {
    const c = (await q1<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tbl} WHERE tenant_id = ?`, [t]))?.n ?? 0;
    await run(`DELETE FROM ${tbl} WHERE tenant_id = ?`, [t]);
    counts[tbl] = c;
  }
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.start_fresh", entityType: "tenant", entityId: t, after: counts, ip: clientIp(req) });
  res.json({ ok: true, cleared: counts });
}));

/* ================= EXTENDED SCHEMES (Add Scheme + Matcher V2) ================= */

const schemeSchema = z.object({
  lender_id: z.number(), product_id: z.number().nullable().optional(), name: z.string().min(2),
  payout_type: z.string().optional(), rate: z.number().nullable().optional(), flat_amount: z.number().nullable().optional(),
  slabs: z.array(z.object({ min: z.number(), max: z.number().nullable(), rate: z.number() })).optional(),
  effective_from: z.string().nullable().optional(), effective_to: z.string().nullable().optional(), status: z.string().optional(),
  profile: z.string().nullable().optional(), states: z.array(z.string()).optional(),
  banker_name: z.string().nullable().optional(), banker_email: z.string().nullable().optional(),
  banker_phone: z.string().nullable().optional(), branch: z.string().nullable().optional(), sub_product: z.string().nullable().optional(),
  loan_params: z.object({
    min_amount: z.number().optional(), max_amount: z.number().optional(), min_tenure: z.number().optional(), max_tenure: z.number().optional(),
    roi_min: z.number().nullable().optional(), roi_max: z.number().nullable().optional(), processing_fee_pct: z.number().nullable().optional(),
    processing_fee_min: z.number().nullable().optional(), processing_fee_max: z.number().nullable().optional(), insurance_pct: z.number().nullable().optional(), other_fees: z.string().nullable().optional(),
    property_area_min: z.number().nullable().optional(), property_area_max: z.number().nullable().optional(),
    bank_tat: z.number().nullable().optional(), rate_notes: z.string().nullable().optional(),
    rate_salaried: z.number().nullable().optional(), rate_senp: z.number().nullable().optional(),
    processing_fee_flat: z.number().nullable().optional(), processing_fee_notes: z.string().nullable().optional()
  }).optional(),
  eligibility: z.object({
    min_age: z.number().nullable().optional(), max_age: z.number().nullable().optional(), min_income: z.number().nullable().optional(),
    min_turnover: z.number().nullable().optional(), min_vintage: z.number().nullable().optional(), max_foir: z.number().nullable().optional(),
    max_ltv: z.number().nullable().optional(), min_credit_score: z.number().nullable().optional(), geo_radius_km: z.number().nullable().optional(),
    property_types: z.array(z.string()).optional(), employment_models: z.array(z.string()).optional(),
    ltv_residential: z.number().nullable().optional(), ltv_commercial: z.number().nullable().optional(), ltv_industrial: z.number().nullable().optional(),
    max_exposure: z.number().nullable().optional(),
    max_enquiries_6m: z.number().nullable().optional(), min_age_bt: z.number().nullable().optional(),
    bt_allowed: z.boolean().optional(), bt_notes: z.string().nullable().optional(),
    city_tiers: z.array(z.string()).optional(), applicant_types: z.array(z.string()).optional()
  }).optional(),
  programs: z.array(z.string()).optional(), purposes: z.array(z.string()).optional(),
  usp: z.string().nullable().optional(), commission_pct: z.number().nullable().optional(),
  policy: z.object({ negative_list: z.array(z.string()).optional(), cibil_required: z.boolean().optional(), notes: z.string().nullable().optional(), circular_url: z.string().nullable().optional(), checks: z.array(z.string()).optional(), city_specific: z.boolean().optional(), variants: z.array(z.string()).optional(), profile_categories: z.array(z.string()).optional() }).optional(),
  circular_file: z.object({ filename: z.string(), mime: z.string().optional(), data: z.string() }).optional(),
  source: z.string().optional(), notes: z.string().nullable().optional()
});

gnAdminRouter.get("/gn/schemes/:id", requirePerm("gn.masters.view"), asyncH(async (req: AuthedRequest, res) => {
  const row = await q1<Record<string, any>>(
    `SELECT s.*, l.name AS lender_name, p.name AS product_name, p.category AS product_category
     FROM gn_schemes s JOIN gn_lenders l ON l.id = s.lender_id LEFT JOIN gn_products p ON p.id = s.product_id
     WHERE s.id = ? AND s.tenant_id = ?`, [req.params.id, T(req)]);
  if (!row) { res.status(404).json({ error: "Scheme not found" }); return; }
  for (const k of ["states", "loan_params", "eligibility", "programs", "purposes", "policy", "slabs"]) {
    try { row[k] = JSON.parse(row[k] || (k === "slabs" ? "[]" : k === "loan_params" || k === "eligibility" || k === "policy" ? "{}" : "[]")); } catch { row[k] = []; }
  }
  res.json(row);
}));

gnAdminRouter.post("/gn/schemes", requirePerm("gn.masters.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = schemeSchema.parse(req.body);
  const id = (await run(
    `INSERT INTO gn_schemes (tenant_id, lender_id, product_id, name, payout_type, rate, flat_amount, slabs,
       effective_from, effective_to, status, profile, states, loan_params, eligibility, programs, purposes, usp, commission_pct, policy, source, notes,
       banker_name, banker_email, banker_phone, branch, sub_product)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [T(req), b.lender_id, b.product_id ?? null, b.name, b.payout_type ?? "percent", b.rate ?? 0, b.flat_amount ?? 0,
     JSON.stringify(b.slabs ?? []), b.effective_from ?? null, b.effective_to ?? null, b.status ?? "active",
     b.profile ?? null, JSON.stringify(b.states ?? []), JSON.stringify(b.loan_params ?? {}), JSON.stringify(b.eligibility ?? {}),
     JSON.stringify(b.programs ?? []), JSON.stringify(b.purposes ?? []), b.usp ?? null, b.commission_pct ?? b.rate ?? 0,
     JSON.stringify(b.policy ?? {}), b.source ?? "manual", b.notes ?? null,
     b.banker_name ?? null, b.banker_email ?? null, b.banker_phone ?? null, b.branch ?? null, b.sub_product ?? null]
  )).lastId;
  // Store the banker circular / scheme document (PDF, image, Excel) alongside the scheme
  if (b.circular_file?.data) {
    const buf = Buffer.from(b.circular_file.data, "base64");
    await run(
      "INSERT INTO gn_scheme_files (tenant_id, scheme_id, kind, filename, mime, size, content, status) VALUES (?, ?, 'circular', ?, ?, ?, ?, 'stored')",
      [T(req), id, b.circular_file.filename || "circular.pdf", b.circular_file.mime || "application/octet-stream", buf.length, b.circular_file.data]
    );
  }
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.scheme.create", entityType: "gn_scheme", entityId: id, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_schemes WHERE id = ?", [id]));
}));

gnAdminRouter.get("/gn/schemes/:id/files", requirePerm("gn.masters.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    "SELECT id, kind, filename, mime, size, status, notes, created_at, (content IS NOT NULL) AS has_content FROM gn_scheme_files WHERE tenant_id = ? AND scheme_id = ? ORDER BY id DESC",
    [T(req), req.params.id]
  );
  res.json(rows);
}));

gnAdminRouter.get("/gn/scheme-files", requirePerm("gn.masters.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT f.id, f.kind, f.filename, f.mime, f.size, f.status, f.notes, f.created_at,
            (f.content IS NOT NULL) AS has_content, s.name AS scheme_name, l.name AS lender_name
     FROM gn_scheme_files f
     LEFT JOIN gn_schemes s ON s.id = f.scheme_id
     LEFT JOIN gn_lenders l ON l.id = s.lender_id
     WHERE f.tenant_id = ? ORDER BY f.id DESC`,
    [T(req)]
  );
  res.json(rows);
}));

gnAdminRouter.get("/gn/scheme-files/:id/download", requirePerm("gn.masters.view"), asyncH(async (req: AuthedRequest, res) => {
  const row = await q1<{ content: string | null; filename: string; mime: string }>(
    "SELECT content, filename, mime FROM gn_scheme_files WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]
  );
  if (!row || !row.content) { res.status(404).json({ error: "File not found" }); return; }
  res.setHeader("Content-Type", row.mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${row.filename}"`);
  res.send(Buffer.from(row.content, "base64"));
}));

gnAdminRouter.delete("/gn/scheme-files/:id", requirePerm("gn.masters.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const before = await q1<{ id: number; filename: string }>("SELECT id, filename FROM gn_scheme_files WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!before) { res.status(404).json({ error: "Not found" }); return; }
  await run("DELETE FROM gn_scheme_files WHERE id = ?", [before.id]);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.scheme_file.delete", entityType: "gn_scheme_file", entityId: before.id, before: { filename: before.filename }, ip: clientIp(req) });
  res.json({ ok: true });
}));

gnAdminRouter.patch("/gn/schemes/:id", requirePerm("gn.masters.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const b = schemeSchema.partial().parse(req.body);
  const before = await q1("SELECT * FROM gn_schemes WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!before) { res.status(404).json({ error: "Scheme not found" }); return; }
  const flat: Record<string, any> = { ...b };
  delete flat.slabs; delete flat.states; delete flat.loan_params; delete flat.eligibility; delete flat.programs; delete flat.purposes; delete flat.policy;
  const sets = Object.keys(flat).map((k) => `${k} = ?`);
  const params: unknown[] = [...Object.values(flat)];
  const jsonCols: [string, string][] = [
    ["slabs", "[]"], ["states", "[]"], ["loan_params", "{}"], ["eligibility", "{}"],
    ["programs", "[]"], ["purposes", "[]"], ["policy", "{}"]
  ];
  for (const [col, dflt] of jsonCols) {
    if ((b as any)[col] !== undefined) { sets.push(`${col} = ?`); params.push(JSON.stringify((b as any)[col] ?? (dflt === "[]" ? [] : {}))); }
  }
  await run(`UPDATE gn_schemes SET ${sets.join(", ")} WHERE id = ?`, [...params, before.id]);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.scheme.update", entityType: "gn_scheme", entityId: before.id, before: { name: before.name, status: before.status }, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_schemes WHERE id = ?", [before.id]));
}));

/** Matcher Configuration V2 — scores customer profiles against full scheme eligibility blocks. */
gnAdminRouter.post("/gn/match/v2", requirePerm("gn.masters.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const b = z.object({
    loan_type: z.string().optional(), amount: z.number(), tenure: z.number().optional(),
    employment_type: z.string().optional(), monthly_income: z.number().nullable().optional(),
    business_turnover: z.number().nullable().optional(), business_vintage: z.number().nullable().optional(),
    credit_score: z.number().nullable().optional(), age: z.number().nullable().optional(),
    enquiries_6m: z.number().nullable().optional(),
    city: z.string().optional(), state: z.string().optional(), property_type: z.string().nullable().optional(),
    ltv: z.number().nullable().optional(),
    existing_exposure: z.number().nullable().optional(), programs: z.array(z.string()).optional()
  }).parse(req.body);
  const schemes = await q<Record<string, any>>(
    `SELECT s.*, l.name AS lender_name, p.name AS product_name, p.category AS product_category
     FROM gn_schemes s JOIN gn_lenders l ON l.id = s.lender_id LEFT JOIN gn_products p ON p.id = s.product_id
     WHERE s.tenant_id = ? AND s.status = 'active'`, [t]);
  const matches = await Promise.all(schemes.map(async (s) => {
    const reasons: string[] = [];
    let ok = true;
    let maybe = false;
    const lp = safeJson(s.loan_params, {});
    const el = safeJson(s.eligibility, {});
    const states = safeJson(s.states, []);
    const programs = safeJson(s.programs, []);
    // Scheme with no configured policy block → lender manual review, never auto-eligible.
    if (Object.keys(lp).length === 0 && Object.keys(el).length === 0) {
      ok = false; maybe = true; reasons.push("Scheme policy not configured — lender manual review");
    }
    if (b.loan_type && s.product_category && s.product_category.toLowerCase() !== b.loan_type.toLowerCase() && !(s.product_name ?? "").toLowerCase().includes(b.loan_type.toLowerCase())) {
      ok = false; reasons.push(`Category ${s.product_category} ≠ ${b.loan_type}`);
    }
    if (lp.min_amount && b.amount < lp.min_amount) { ok = false; reasons.push(`Amount below ₹${lp.min_amount.toLocaleString("en-IN")}`); }
    if (lp.max_amount && b.amount > lp.max_amount) { ok = false; reasons.push(`Amount above ₹${lp.max_amount.toLocaleString("en-IN")}`); }
    if (b.tenure && lp.min_tenure && b.tenure < lp.min_tenure) { ok = false; reasons.push(`Tenure below ${lp.min_tenure} mo`); }
    if (b.tenure && lp.max_tenure && b.tenure > lp.max_tenure) { ok = false; reasons.push(`Tenure above ${lp.max_tenure} mo`); }
    if (b.age != null && el.min_age && b.age < el.min_age) { ok = false; reasons.push(`Age below ${el.min_age}`); }
    if (b.age != null && el.max_age && b.age > el.max_age) { ok = false; reasons.push(`Age above ${el.max_age}`); }
    if (b.monthly_income != null && el.min_income && b.monthly_income < el.min_income) { ok = false; reasons.push(`Income below ₹${el.min_income.toLocaleString("en-IN")}/mo`); }
    if (b.business_turnover != null && el.min_turnover && b.business_turnover < el.min_turnover) { ok = false; reasons.push(`Turnover below ₹${el.min_turnover.toLocaleString("en-IN")}`); }
    if (b.business_vintage != null && el.min_vintage && b.business_vintage < el.min_vintage) { ok = false; reasons.push(`Vintage below ${el.min_vintage} yrs`); }
    if (b.credit_score != null && el.min_credit_score && b.credit_score < el.min_credit_score) {
      ok = false; reasons.push(`CIBIL below ${el.min_credit_score}`); maybe = true;
    }
    if (b.enquiries_6m != null && el.max_enquiries_6m && b.enquiries_6m > el.max_enquiries_6m) { ok = false; reasons.push(`Enquiries (${b.enquiries_6m} in 6mo) above max ${el.max_enquiries_6m}`); }
    if (b.existing_exposure != null && el.max_exposure && b.existing_exposure > el.max_exposure) { ok = false; reasons.push(`Existing exposure above ₹${el.max_exposure.toLocaleString("en-IN")}`); }
    if (b.programs?.length && programs.length && !b.programs.some((p) => programs.includes(p))) { ok = false; reasons.push(`Program not offered: ${b.programs.join(", ")}`); }
    if (states.length && b.state && !states.includes(b.state) && !states.includes("All India")) { ok = false; reasons.push(`Not offered in ${b.state}`); }
    if (b.property_type && el.property_types?.length && !el.property_types.includes(b.property_type)) { ok = false; reasons.push(`Property type ${b.property_type} not covered`); }
    // Property-specific LTV (residential / commercial / industrial) takes precedence over the blanket max_ltv
    const propKey = b.property_type ? { Residential: "ltv_residential", Commercial: "ltv_commercial", Industrial: "ltv_industrial" }[b.property_type] : null;
    const propLtv = propKey ? el[propKey] : null;
    const effectiveLtv = propLtv ?? el.max_ltv;
    if (effectiveLtv && b.ltv != null && b.ltv > effectiveLtv) { ok = false; reasons.push(`LTV above ${effectiveLtv}% for ${b.property_type ?? "asset"}`); }
    if (b.employment_type && el.employment_models?.length && !el.employment_models.some((m: string) => m.toLowerCase().includes(b.employment_type!.toLowerCase().replace("_", " ")))) {
      ok = false; reasons.push(`Employment profile ${b.employment_type} not covered`);
    }
    // Applicant-type acceptance (reference categories: Salaried / Self-Employed Professional / Trust / NRI …)
    if (b.employment_type && el.applicant_types?.length) {
      const t = b.employment_type.toLowerCase().replace("_", " ");
      const covered = el.applicant_types.some((a: string) => a.toLowerCase().includes(t) || t.includes(a.toLowerCase().split(" ")[0]));
      if (!covered) { ok = false; reasons.push(`Applicant type ${b.employment_type} not accepted`); }
    }
    // BT (balance transfer) gating — scheme allows BT only when the applicant's program is BT
    if (el.bt_allowed === false && b.programs?.includes("Balance Transfer")) { ok = false; reasons.push("BT not allowed on this scheme"); }
    const status: "eligible" | "maybe" | "not_eligible" = ok ? "eligible" : maybe ? "maybe" : "not_eligible";
    const settings = await gnSettings(t);
    const payout = s.commission_pct ?? s.rate ?? 0;
    const commission = computeCommission(b.amount, payout, settings);
    return {
      id: s.id, scheme: s.name, lender: s.lender_name, product: s.product_name ?? s.product_category,
      profile: s.profile, payout_type: s.payout_type, rate: s.rate, flat_amount: s.flat_amount, commission_pct: payout,
      roi: lp.roi_min != null && lp.roi_max != null ? `${lp.roi_min}–${lp.roi_max}%` : null,
      processing_fee: lp.processing_fee_pct != null ? `${lp.processing_fee_pct}%` : null,
      max_ltv: el.max_ltv, max_foir: el.max_foir, programs, states: states.length ? states : ["All India"],
      status, reasons, commission
    };
  }));
  const rank = { eligible: 0, maybe: 1, not_eligible: 2 };
  matches.sort((a, b) => rank[a.status] - rank[b.status]);
  res.json({
    matches,
    summary: {
      eligible: matches.filter((m) => m.status === "eligible").length,
      maybe: matches.filter((m) => m.status === "maybe").length,
      notEligible: matches.filter((m) => m.status === "not_eligible").length
    }
  });
}));

function safeJson(v: string, dflt: any): any {
  try { const p = JSON.parse(v); return p ?? dflt; } catch { return dflt; }
}

/* ================= IMPORT / EXPORT ================= */

const EXPORT_ENTITIES: Record<string, { table: string; select: string; where: string; filter?: string }> = {
  applications: { table: "gn_applications", select: "a.*, l.name AS lender_name, p.name AS product_name, par.name AS partner_name, s.name AS scheme_name", where: "LEFT JOIN gn_lenders l ON l.id = a.lender_id LEFT JOIN gn_products p ON p.id = a.product_id LEFT JOIN gn_partners par ON par.id = a.partner_id LEFT JOIN gn_schemes s ON s.id = a.scheme_id" },
  leads: { table: "gn_applications", select: "a.*, l.name AS lender_name", where: "LEFT JOIN gn_lenders l ON l.id = a.lender_id", filter: "a.stage = 'lead'" },
  lenders: { table: "gn_lenders", select: "*", where: "" },
  products: { table: "gn_products", select: "*", where: "" },
  schemes: { table: "gn_schemes", select: "a.*, l.name AS lender_name", where: "LEFT JOIN gn_lenders l ON l.id = a.lender_id" },
  partners: { table: "gn_partners", select: "a.*, par.name AS parent_name", where: "LEFT JOIN gn_partners par ON par.id = a.parent_id" },
  tasks: { table: "gn_tasks", select: "a.*, u.name AS assigned_name", where: "LEFT JOIN users u ON u.id = a.assigned_to" },
  commissions: { table: "gn_commissions", select: "a.*", where: "" },
  expenses: { table: "gn_expenses", select: "a.*", where: "" },
  fees: { table: "gn_customer_fees", select: "a.*", where: "" },
  campaigns: { table: "gn_campaigns", select: "a.*", where: "" },
  documents: { table: "gn_documents", select: "a.*", where: "" },
  leave: { table: "gn_leave_requests", select: "a.*, u.name AS user_name", where: "JOIN users u ON u.id = a.user_id" },
  payroll: { table: "gn_payroll", select: "a.*, u.name AS user_name", where: "JOIN users u ON u.id = a.user_id" },
  attendance: { table: "gn_attendance", select: "a.*, u.name AS user_name", where: "JOIN users u ON u.id = a.user_id" },
  /* ---- Command center & bulk entities ---- */
  applicants: { table: "gn_applicants", select: "a.*", where: "" },
  bulk_batches: { table: "gn_bulk_batches", select: "a.*, u.name AS created_name", where: "LEFT JOIN users u ON u.id = a.created_by" },
  api_logs: { table: "gn_api_logs", select: "a.*", where: "" },
  webhook_events: { table: "gn_webhook_events", select: "a.*", where: "" },
  /* ---- Marketing / Inbox / Help / Recycle ---- */
  workflows: { table: "gn_workflows", select: "a.*", where: "" },
  ivr_menus: { table: "gn_ivr_menus", select: "a.*", where: "" },
  call_logs: { table: "gn_call_logs", select: "a.*, m.name AS ivr_name", where: "LEFT JOIN gn_ivr_menus m ON m.id = a.ivr_menu_id" },
  templates: { table: "gn_message_templates", select: "a.*", where: "" },
  drips: { table: "gn_whatsapp_drips", select: "a.*, mt.name AS template_name", where: "LEFT JOIN gn_message_templates mt ON mt.id = a.template_id" },
  inbox: { table: "gn_inbox_messages", select: "a.*", where: "" },
  docs: { table: "gn_docs", select: "a.*, u.name AS updated_name", where: "LEFT JOIN users u ON u.id = a.updated_by" },
  faqs: { table: "gn_faqs", select: "a.*", where: "" },
  tickets: { table: "gn_support_tickets", select: "a.*, u.name AS created_name", where: "LEFT JOIN users u ON u.id = a.created_by" },
  changelog: { table: "gn_changelog", select: "a.*", where: "" },
  /* ---- Core NEXUS entities (LOS / LMS / CRM) so every dashboard can export ---- */
  customers: { table: "customers", select: "a.*", where: "" },
  core_leads: { table: "leads", select: "a.*, u.name AS owner_name", where: "LEFT JOIN users u ON u.id = a.owner_id" },
  los_apps: { table: "applications", select: "a.*, cu.name AS customer_name, p.name AS product_name", where: "JOIN customers cu ON cu.id = a.customer_id LEFT JOIN products p ON p.id = a.product_id" },
  loans: { table: "loans", select: "a.*, cu.name AS customer_name, p.name AS product_name", where: "JOIN customers cu ON cu.id = a.customer_id LEFT JOIN products p ON p.id = a.product_id" },
  payments: { table: "payments", select: "a.*, l.loan_no, cu.name AS customer_name", where: "JOIN loans l ON l.id = a.loan_id LEFT JOIN customers cu ON cu.id = a.customer_id" },
  collections: { table: "collection_tasks", select: "a.*, l.loan_no, cu.name AS customer_name", where: "JOIN loans l ON l.id = a.loan_id LEFT JOIN customers cu ON cu.id = a.customer_id" },
  core_documents: { table: "documents", select: "a.*, cu.name AS customer_name", where: "LEFT JOIN customers cu ON cu.id = a.customer_id" }
};

function toCsv(rows: Record<string, any>[]): string {
  if (!rows.length) return "";
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "\uFEFF" + cols.join(",") + "\n" + rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
}

gnAdminRouter.get("/gn/export/:entity", requirePerm("gn.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const def = EXPORT_ENTITIES[req.params.entity];
  if (!def) { res.status(400).json({ error: `Unknown entity: ${req.params.entity}` }); return; }
  const rows = await q<Record<string, any>>(`SELECT ${def.select} FROM ${def.table} a ${def.where} WHERE a.tenant_id = ? ${def.filter ? `AND ${def.filter}` : ""} ORDER BY a.id DESC`, [t]);
  const csv = toCsv(rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="gn_${req.params.entity}_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
}));

gnAdminRouter.post("/gn/import/:entity", requirePerm("gn.*"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const entity = req.params.entity;
  const body: any = req.body ?? {};
  let rows: Record<string, any>[];
  if (Array.isArray(body.rows)) rows = body.rows;
  else if (typeof body.csv === "string") rows = parseCsv(body.csv);
  else if (Array.isArray(body)) rows = body;
  else return void res.status(400).json({ error: "Send { rows: [...] } or { csv: \"...\" }" });

  const inserted: number[] = [];
  const errors: { row: number; error: string }[] = [];
  const lenderByName = new Map((await q<{ id: number; name: string }>("SELECT id, name FROM gn_lenders WHERE tenant_id = ?", [t]) ?? []).map((r) => [r.name, r.id]));
  const productByName = new Map((await q<{ id: number; name: string }>("SELECT id, name FROM gn_products WHERE tenant_id = ?", [t]) ?? []).map((r) => [r.name, r.id]));
  const partnerByName = new Map((await q<{ id: number; name: string }>("SELECT id, name FROM gn_partners WHERE tenant_id = ?", [t]) ?? []).map((r) => [r.name, r.id]));
  const schemeByName = new Map((await q<{ id: number; name: string }>("SELECT id, name FROM gn_schemes WHERE tenant_id = ?", [t]) ?? []).map((r) => [r.name, r.id]));

  for (const [i, raw] of rows.entries()) {
    const r: Record<string, any> = {};
    for (const k of Object.keys(raw)) r[k.toLowerCase().replace(/[^a-z0-9_]/g, "_")] = raw[k];
    const num = (v: any) => (v === "" || v === null || v === undefined ? null : Number(String(v).replace(/[₹,\s]/g, "")));
    const str = (v: any) => (v === "" || v === null || v === undefined ? null : String(v));
    try {
      switch (entity) {
        case "applications":
        case "leads": {
          if (!r.name || !r.mobile) throw new Error("name + mobile required");
          const lenderId = r.lender_id ? Number(r.lender_id) : (r.lender_name ? lenderByName.get(r.lender_name) : null);
          const productId = r.product_id ? Number(r.product_id) : (r.product_name ? productByName.get(r.product_name) : null);
          const partnerId = r.partner_id ? Number(r.partner_id) : (r.partner_name ? partnerByName.get(r.partner_name) : null);
          const schemeId = r.scheme_id ? Number(r.scheme_id) : (r.scheme_name ? schemeByName.get(r.scheme_name) : null);
          const status = r.status && GN_STATUS.some((s) => s.slug === r.status) ? r.status : "app_created";
          const stage = r.stage || (GN_STATUS.find((s) => s.slug === status)?.group === "lead" ? "lead" : "application");
          const year = new Date().getFullYear();
          const seq = ((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM gn_applications WHERE tenant_id = ?", [t]))?.n ?? 0) + i + 1;
          const ref = r.ref ?? `GN-${year}-${String(10000 + seq)}`;
          const id = (await run(
            `INSERT INTO gn_applications (tenant_id, ref, name, mobile, email, city, state, employment_type, monthly_income, business_turnover, business_vintage, loan_type, product_id, lender_id, scheme_id, dsa_code, partner_id, amount, tenure, purpose, status, stage, source, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [t, ref, r.name, r.mobile, str(r.email), str(r.city), str(r.state), str(r.employment_type), num(r.monthly_income), num(r.business_turnover), num(r.business_vintage),
             str(r.loan_type), productId, lenderId, schemeId, str(r.dsa_code), partnerId, num(r.amount) ?? 0, num(r.tenure) ?? 12, str(r.purpose), status, stage, str(r.source) ?? "dsa", str(r.notes)]
          )).lastId;
          inserted.push(id);
          break;
        }
        case "applicants": {
          if (!r.name || !r.mobile) throw new Error("name + mobile required");
          const seq = ((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM gn_applicants WHERE tenant_id = ?", [t]))?.n ?? 0) + i + 1;
          const ref = r.ref ?? `GN-APL-${new Date().getFullYear()}-${String(10000 + seq)}`;
          const id = (await run(
            `INSERT INTO gn_applicants (tenant_id, ref, name, mobile, email, pan, dob, city, state, pincode, applicant_type, employment_type,
               business_name, business_type, business_vintage, monthly_income, annual_turnover, loan_type, loan_amount, tenure, purpose, source, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [t, ref, r.name, r.mobile, str(r.email), str(r.pan), str(r.dob), str(r.city), str(r.state), str(r.pincode),
             str(r.applicant_type) ?? "Individual", str(r.employment_type), str(r.business_name), str(r.business_type), num(r.business_vintage),
             num(r.monthly_income), num(r.annual_turnover), str(r.loan_type), num(r.loan_amount), num(r.tenure), str(r.purpose),
             str(r.source) ?? "import", str(r.notes)]
          )).lastId;
          inserted.push(id);
          break;
        }
        case "lenders": {
          if (!r.name) throw new Error("name required");
          const id = (await run("INSERT INTO gn_lenders (tenant_id, name, type, dsa_code, api_status, status) VALUES (?, ?, ?, ?, ?, ?)",
            [t, r.name, str(r.type) ?? "Bank", str(r.dsa_code), str(r.api_status) ?? "mock", str(r.status) ?? "active"])).lastId;
          inserted.push(id);
          break;
        }
        case "products": {
          if (!r.name || !r.category || !r.lender_name && !r.lender_id) throw new Error("name + category + lender required");
          const lenderId = r.lender_id ? Number(r.lender_id) : lenderByName.get(r.lender_name);
          if (!lenderId) throw new Error(`Unknown lender: ${r.lender_name}`);
          const id = (await run(
            `INSERT INTO gn_products (tenant_id, lender_id, category, name, min_amount, max_amount, min_tenure, max_tenure, roi_min, roi_max, processing_fee_pct, payout_pct, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [t, lenderId, r.category, r.name, num(r.min_amount) ?? 100000, num(r.max_amount) ?? 5000000, num(r.min_tenure) ?? 12, num(r.max_tenure) ?? 60,
             num(r.roi_min), num(r.roi_max), num(r.processing_fee_pct) ?? 0, num(r.payout_pct) ?? 0, str(r.status) ?? "active"])).lastId;
          inserted.push(id);
          break;
        }
        case "schemes": {
          inserted.push(await importSchemeRow(t, r, lenderByName, "import"));
          break;
        }
        case "partners": {
          if (!r.name) throw new Error("name required");
          const id = (await run("INSERT INTO gn_partners (tenant_id, name, type, phone, email, commission_pct, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [t, r.name, str(r.type) ?? "DSA", str(r.phone), str(r.email), num(r.commission_pct) ?? 0, str(r.status) ?? "active"])).lastId;
          inserted.push(id);
          break;
        }
        case "tasks": {
          if (!r.title) throw new Error("title required");
          const id = (await run("INSERT INTO gn_tasks (tenant_id, title, priority, status, due_at, created_by) VALUES (?, ?, ?, ?, ?, ?)",
            [t, r.title, str(r.priority) ?? "medium", str(r.status) ?? "pending", str(r.due_at), req.user!.id])).lastId;
          inserted.push(id);
          break;
        }
        case "expenses": {
          if (!r.title && !r.category) throw new Error("title/category required");
          const id = (await run("INSERT INTO gn_expenses (tenant_id, title, category, vendor, amount, paid, expense_date) VALUES (?, ?, ?, ?, ?, 0, ?)",
            [t, str(r.title) ?? str(r.category) ?? "Expense", str(r.category) ?? "operations", str(r.vendor), num(r.amount) ?? 0, str(r.expense_date) ?? str(r.date) ?? new Date().toISOString().slice(0, 10)])).lastId;
          inserted.push(id);
          break;
        }
        case "fees": {
          if (!r.app_id) throw new Error("app_id required");
          const id = (await run("INSERT INTO gn_customer_fees (tenant_id, app_id, processing, insurance, rto, other, disbursed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [t, Number(r.app_id), num(r.processing) ?? 0, num(r.insurance) ?? 0, num(r.rto) ?? 0, num(r.other) ?? 0, str(r.disbursed_at)])).lastId;
          inserted.push(id);
          break;
        }
        case "campaigns": {
          if (!r.name) throw new Error("name required");
          const id = (await run("INSERT INTO gn_campaigns (tenant_id, name, channel, spend, leads, applications, disbursed_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [t, r.name, str(r.channel) ?? "meta", num(r.spend) ?? 0, num(r.leads) ?? 0, num(r.applications) ?? 0, num(r.disbursed_amount) ?? 0, str(r.status) ?? "active"])).lastId;
          inserted.push(id);
          break;
        }
        case "customers": {
          if (!r.name) throw new Error("name required");
          const seq = ((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM customers WHERE tenant_id = ?", [t]))?.n ?? 0) + i + 1;
          const id = (await run(
            `INSERT INTO customers (tenant_id, customer_no, name, mobile, email, dob, gender, pan, address_line1, city, state, pincode, employment_type, business_name, annual_income, monthly_income, business_turnover, credit_score)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [t, r.customer_no ?? `CUS${String(10000 + seq)}`, r.name, str(r.mobile), str(r.email), str(r.dob), str(r.gender), str(r.pan), str(r.address_line1), str(r.city), str(r.state), str(r.pincode),
             str(r.employment_type), str(r.business_name), num(r.annual_income), num(r.monthly_income), num(r.business_turnover), num(r.credit_score)])).lastId;
          inserted.push(id);
          break;
        }
        case "core_leads": {
          if (!r.name) throw new Error("name required");
          const seq = ((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM leads WHERE tenant_id = ?", [t]))?.n ?? 0) + i + 1;
          const id = (await run(
            `INSERT INTO leads (tenant_id, lead_no, name, mobile, email, city, state, loan_type, requested_amount, monthly_income, business_turnover, source, campaign, status, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [t, r.lead_no ?? `LD-${new Date().getFullYear()}-${String(10000 + seq)}`, r.name, str(r.mobile), str(r.email), str(r.city), str(r.state),
             str(r.loan_type), num(r.requested_amount), num(r.monthly_income), num(r.business_turnover),
             str(r.source) ?? "manual", str(r.campaign), str(r.status) ?? "new", str(r.notes)])).lastId;
          inserted.push(id);
          break;
        }
        case "los_apps": {
          if (!r.customer_name && !r.customer_id) throw new Error("customer required");
          if (!r.product_name && !r.product_id) throw new Error("product required");
          const customerId = r.customer_id ? Number(r.customer_id) : ((await q1<{ id: number }>("SELECT id FROM customers WHERE tenant_id = ? AND name = ?", [t, r.customer_name]))?.id);
          if (!customerId) throw new Error(`Unknown customer: ${r.customer_name}`);
          const productId = r.product_id ? Number(r.product_id) : ((await q1<{ id: number }>("SELECT id FROM products WHERE tenant_id = ? AND name = ?", [t, r.product_name]))?.id);
          if (!productId) throw new Error(`Unknown product: ${r.product_name}`);
          const seq = ((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM applications WHERE tenant_id = ?", [t]))?.n ?? 0) + i + 1;
          const id = (await run(
            `INSERT INTO applications (tenant_id, application_no, customer_id, product_id, source, requested_amount, tenure, purpose, status, stage)
             VALUES (?, ?, ?, ?, 'import', ?, ?, ?, ?, ?)`,
            [t, r.application_no ?? `APP-${new Date().getFullYear()}-${String(10000 + seq)}`, customerId, productId,
             num(r.requested_amount) ?? 0, num(r.tenure) ?? 12, str(r.purpose), str(r.status) ?? "draft", str(r.stage) ?? "application"])).lastId;
          inserted.push(id);
          break;
        }
        case "loans": {
          if (!r.customer_name && !r.customer_id) throw new Error("customer required");
          if (!r.product_name && !r.product_id) throw new Error("product required");
          if (r.principal === undefined || r.principal === "") throw new Error("principal required");
          const customerId = r.customer_id ? Number(r.customer_id) : ((await q1<{ id: number }>("SELECT id FROM customers WHERE tenant_id = ? AND name = ?", [t, r.customer_name]))?.id);
          if (!customerId) throw new Error(`Unknown customer: ${r.customer_name}`);
          const productId = r.product_id ? Number(r.product_id) : ((await q1<{ id: number }>("SELECT id FROM products WHERE tenant_id = ? AND name = ?", [t, r.product_name]))?.id);
          if (!productId) throw new Error(`Unknown product: ${r.product_name}`);
          const rate = num(r.rate) ?? 0;
          const tenure = num(r.tenure) ?? 12;
          const principal = num(r.principal) ?? 0;
          const emi = num(r.emi) ?? Math.round((principal * rate / 100 / 12 * Math.pow(1 + rate / 100 / 12, tenure)) / (Math.pow(1 + rate / 100 / 12, tenure) - 1));
          const seq = ((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM loans WHERE tenant_id = ?", [t]))?.n ?? 0) + i + 1;
          const id = (await run(
            `INSERT INTO loans (tenant_id, loan_no, customer_id, product_id, principal, rate, tenure, emi, disbursed_at, first_emi_at, status, outstanding)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [t, r.loan_no ?? `LN-${new Date().getFullYear()}-${String(10000 + seq)}`, customerId, productId, principal, rate ?? 0, tenure, emi,
             str(r.disbursed_at) ?? new Date().toISOString().slice(0, 10), str(r.first_emi_at), str(r.status) ?? "active", num(r.outstanding) ?? principal])).lastId;
          inserted.push(id);
          break;
        }
        case "payments": {
          if (!r.loan_no && !r.loan_id) throw new Error("loan required");
          if (r.amount === undefined || r.amount === "") throw new Error("amount required");
          const loan = r.loan_id ? await q1<{ id: number; customer_id: number; loan_no: string }>("SELECT id, customer_id, loan_no FROM loans WHERE id = ? AND tenant_id = ?", [Number(r.loan_id), t])
            : await q1<{ id: number; customer_id: number; loan_no: string }>("SELECT id, customer_id, loan_no FROM loans WHERE loan_no = ? AND tenant_id = ?", [r.loan_no, t]);
          if (!loan) throw new Error(`Unknown loan: ${r.loan_no ?? r.loan_id}`);
          const seq = ((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE tenant_id = ?", [t]))?.n ?? 0) + i + 1;
          const id = (await run(
            `INSERT INTO payments (tenant_id, loan_id, customer_id, receipt_no, amount, mode, reference, status, received_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [t, loan.id, loan.customer_id, r.receipt_no ?? `RCPT-${new Date().getFullYear()}-${String(10000 + seq)}`, num(r.amount) ?? 0,
             str(r.mode) ?? "cash", str(r.reference), str(r.status) ?? "received", str(r.received_at) ?? str(r.date) ?? new Date().toISOString().slice(0, 10)])).lastId;
          inserted.push(id);
          break;
        }
        case "collections": {
          if (!r.loan_no && !r.loan_id) throw new Error("loan required");
          const loan = r.loan_id ? await q1<{ id: number; customer_id: number }>("SELECT id, customer_id FROM loans WHERE id = ? AND tenant_id = ?", [Number(r.loan_id), t])
            : await q1<{ id: number; customer_id: number }>("SELECT id, customer_id FROM loans WHERE loan_no = ? AND tenant_id = ?", [r.loan_no, t]);
          if (!loan) throw new Error(`Unknown loan: ${r.loan_no ?? r.loan_id}`);
          const id = (await run(
            `INSERT INTO collection_tasks (tenant_id, loan_id, customer_id, agent_id, priority, kind, note, due_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [t, loan.id, loan.customer_id, r.agent_id ? Number(r.agent_id) : null, str(r.priority) ?? "high", str(r.kind) ?? "call", str(r.note),
             str(r.due_at) ?? str(r.followup_at), str(r.status) ?? "open"])).lastId;
          inserted.push(id);
          break;
        }
        case "documents": {
          if (!r.category) throw new Error("category required");
          const customerId = r.customer_name ? ((await q1<{ id: number }>("SELECT id FROM customers WHERE tenant_id = ? AND name = ?", [t, r.customer_name]))?.id) : (r.customer_id ? Number(r.customer_id) : null);
          const appId = r.application_id ? Number(r.application_id) : null;
          const id = (await run(
            `INSERT INTO documents (tenant_id, customer_id, application_id, category, name, file_path, status, verified_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [t, customerId, appId, r.category, str(r.name) ?? r.category, str(r.file_path), str(r.status) ?? "uploaded", str(r.verified_at)])).lastId;
          inserted.push(id);
          break;
        }
        case "workflows": {
          if (!r.name) throw new Error("name required");
          const id = (await run("INSERT INTO gn_workflows (tenant_id, name, trigger, route, actions, status) VALUES (?, ?, ?, ?, ?, ?)",
            [t, r.name, str(r.trigger) ?? "lead_captured", str(r.route) ?? "score_round_robin", str(r.actions) ?? "[]", str(r.status) ?? "draft"])).lastId;
          inserted.push(id);
          break;
        }
        case "ivr_menus": {
          if (!r.name) throw new Error("name required");
          const id = (await run("INSERT INTO gn_ivr_menus (tenant_id, name, greeting, menu_options, fallback, status) VALUES (?, ?, ?, ?, ?, ?)",
            [t, r.name, str(r.greeting), str(r.menu_options) ?? "[]", str(r.fallback) ?? "Telecalling", str(r.status) ?? "active"])).lastId;
          inserted.push(id);
          break;
        }
        case "call_logs": {
          if (!r.call_id) throw new Error("call_id required");
          const id = (await run("INSERT INTO gn_call_logs (tenant_id, call_id, caller, ivr_menu_id, route, outcome, duration_sec, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [t, r.call_id, str(r.caller), r.ivr_menu_id ? Number(r.ivr_menu_id) : null, str(r.route) ?? "telecalling", str(r.outcome) ?? "connected", num(r.duration_sec) ?? 0, str(r.notes)])).lastId;
          inserted.push(id);
          break;
        }
        case "templates": {
          if (!r.name || !r.body) throw new Error("name + body required");
          const id = (await run("INSERT INTO gn_message_templates (tenant_id, name, category, purpose, body, variables, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [t, r.name, str(r.category) ?? "whatsapp", str(r.purpose) ?? "promotional", r.body, str(r.variables) ?? "[]", str(r.status) ?? "approved"])).lastId;
          inserted.push(id);
          break;
        }
        case "drips": {
          if (!r.name) throw new Error("name required");
          const id = (await run("INSERT INTO gn_whatsapp_drips (tenant_id, name, trigger, audience, template_id, schedule, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [t, r.name, str(r.trigger) ?? "lead_captured", str(r.audience) ?? "all_leads", r.template_id ? Number(r.template_id) : null, str(r.schedule) ?? "immediate", str(r.status) ?? "active"])).lastId;
          inserted.push(id);
          break;
        }
        case "inbox": {
          if (!r.body) throw new Error("body required");
          const id = (await run("INSERT INTO gn_inbox_messages (tenant_id, direction, channel, from_contact, to_contact, subject, body, related_type, related_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [t, str(r.direction) ?? "in", str(r.channel) ?? "whatsapp", str(r.from_contact), str(r.to_contact), str(r.subject), r.body, str(r.related_type), r.related_id ? Number(r.related_id) : null, str(r.status) ?? "unread"])).lastId;
          inserted.push(id);
          break;
        }
        case "docs": {
          if (!r.title) throw new Error("title required");
          const id = (await run("INSERT INTO gn_docs (tenant_id, title, slug, category, content) VALUES (?, ?, ?, ?, ?)",
            [t, r.title, str(r.slug), str(r.category) ?? "Getting Started", str(r.content) ?? ""])).lastId;
          inserted.push(id);
          break;
        }
        case "faqs": {
          if (!r.question || !r.answer) throw new Error("question + answer required");
          const id = (await run("INSERT INTO gn_faqs (tenant_id, question, answer, category) VALUES (?, ?, ?, ?)",
            [t, r.question, r.answer, str(r.category) ?? "General"])).lastId;
          inserted.push(id);
          break;
        }
        case "tickets": {
          if (!r.subject) throw new Error("subject required");
          const id = (await run("INSERT INTO gn_support_tickets (tenant_id, subject, message, priority, status, category) VALUES (?, ?, ?, ?, ?, ?)",
            [t, r.subject, str(r.message) ?? "", str(r.priority) ?? "medium", str(r.status) ?? "open", str(r.category) ?? "Bug"])).lastId;
          inserted.push(id);
          break;
        }
        case "changelog": {
          if (!r.version || !r.title) throw new Error("version + title required");
          const id = (await run("INSERT INTO gn_changelog (tenant_id, version, title, content, category) VALUES (?, ?, ?, ?, ?)",
            [t, r.version, r.title, str(r.content) ?? "", str(r.category) ?? "feature"])).lastId;
          inserted.push(id);
          break;
        }
        default:
          throw new Error(`Import not supported for ${entity}`);
      }
    } catch (e) {
      errors.push({ row: i + 1, error: (e as Error).message });
    }
  }
  await audit({ tenantId: t, userId: req.user!.id, action: `gn.import.${entity}`, entityType: "gn_import", after: { entity, inserted: inserted.length, errors: errors.length }, ip: clientIp(req) });
  res.json({ ok: true, entity, inserted: inserted.length, errors });
}));

function parseCsv(text: string): Record<string, any>[] {
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (!clean) return [];
  const lines: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '"') { if (inQ && clean[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === "\n" && !inQ) { lines.push(cur); cur = ""; }
    else cur += c;
  }
  lines.push(cur);
  const split = (line: string, sep: string) => {
    const out: string[] = [];
    let f = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { f += '"'; i++; } else q = !q; }
      else if (c === sep && !q) { out.push(f); f = ""; }
      else f += c;
    }
    out.push(f);
    return out.map((s) => s.trim());
  };
  const parseDelimited = (text: string, sep: string): Record<string, any>[] => {
    const cl = text.replace(/^\uFEFF/, "").trim();
    if (!cl) return [];
    const lines: string[] = [];
    let cur = ""; let inQ = false;
    for (let i = 0; i < cl.length; i++) {
      const c = cl[i];
      if (c === '"') { if (inQ && cl[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (c === "\n" && !inQ) { lines.push(cur); cur = ""; }
      else cur += c;
    }
    lines.push(cur);
    const header = split(lines[0], sep);
    return lines.slice(1).filter((l) => l.trim()).map((l) => {
      const cells = split(l, sep);
      const row: Record<string, any> = {};
      header.forEach((h, i) => { row[h] = cells[i] ?? ""; });
      return row;
    });
  };
  return parseDelimited(clean, ",");
}

/** Insert a scheme from a flat row (CSV/Excel/JSON column names are normalized). Returns the new scheme id or throws. */
async function importSchemeRow(t: number, raw: Record<string, any>, lenderByName: Map<string, number>, source: string) {
  const r: Record<string, any> = {};
  for (const k of Object.keys(raw)) r[k.toLowerCase().replace(/[^a-z0-9_]/g, "_")] = raw[k];
  const num = (v: any) => (v === "" || v === null || v === undefined ? null : Number(String(v).replace(/[₹,\s]/g, "")));
  const str = (v: any) => (v === "" || v === null || v === undefined ? null : String(v));
  const list = (v: any) => (typeof v === "string" && v.trim() ? v.split(/[,;]/).map((x: string) => x.trim()).filter(Boolean) : Array.isArray(v) ? v.map(String) : []);
  if (!r.name) throw new Error("name required");
  const lenderId = r.lender_id ? Number(r.lender_id) : (r.lender_name ? lenderByName.get(r.lender_name) : null);
  if (!lenderId) throw new Error(`Unknown or missing lender: ${r.lender_name ?? r.lender_id}`);
  const loanParams = {
    min_amount: num(r.min_amount) ?? num(r.loan_amount_min),
    max_amount: num(r.max_amount) ?? num(r.loan_amount_max),
    min_tenure: num(r.min_tenure) ?? num(r.tenure_min),
    max_tenure: num(r.max_tenure) ?? num(r.tenure_max),
    roi_min: num(r.roi_min), roi_max: num(r.roi_max),
    processing_fee_pct: num(r.processing_fee_pct) ?? num(r.processing_fee_percent),
    processing_fee_min: num(r.processing_fee_min), processing_fee_max: num(r.processing_fee_max) ?? num(r.processing_fee_cap),
    processing_fee_flat: num(r.processing_fee_flat) ?? num(r.processing_fee_flat_amount),
    processing_fee_notes: str(r.processing_fee_notes),
    insurance_pct: num(r.insurance_pct), other_fees: str(r.other_fees),
    property_area_min: num(r.property_area_min), property_area_max: num(r.property_area_max),
    bank_tat: num(r.bank_tat) ?? num(r.tat_days),
    rate_notes: str(r.rate_notes), rate_salaried: num(r.rate_salaried) ?? num(r.rate_salaried_pct), rate_senp: num(r.rate_senp) ?? num(r.rate_senp_pct)
  };
  const eligibility = {
    min_age: num(r.min_age), max_age: num(r.max_age),
    min_income: num(r.min_income) ?? num(r.min_monthly_income),
    min_turnover: num(r.min_turnover) ?? num(r.min_annual_turnover),
    min_vintage: num(r.min_vintage) ?? num(r.min_business_vintage),
    max_foir: num(r.max_foir) ?? num(r.foir),
    max_ltv: num(r.max_ltv) ?? num(r.ltv),
    ltv_residential: num(r.ltv_residential) ?? num(r.ltv_res),
    ltv_commercial: num(r.ltv_commercial),
    ltv_industrial: num(r.ltv_industrial),
    min_credit_score: num(r.min_credit_score) ?? num(r.min_cibil) ?? num(r.cibil),
    geo_radius_km: num(r.geo_radius_km) ?? num(r.geo_radius),
    property_types: list(r.property_types) ?? list(r.eligible_property_types),
    employment_models: list(r.employment_models),
    max_enquiries_6m: num(r.max_enquiries_6m) ?? num(r.max_enquiries),
    bt_allowed: typeof r.bt_allowed === "string" ? ["yes", "true", "1", "y", "allowed"].includes(String(r.bt_allowed).toLowerCase()) : undefined,
    bt_notes: str(r.bt_notes),
    city_tiers: list(r.city_tiers),
    applicant_types: list(r.applicant_types) ?? list(r.accepted_applicant_types),
    max_exposure: num(r.max_exposure)
  };
  const cibilReqRaw = String(r.cibil_required ?? "").toLowerCase();
  const policy = {
    negative_list: list(r.negative_list),
    cibil_required: ["yes", "true", "1", "y"].includes(cibilReqRaw) ? true : ["no", "false", "0", "n"].includes(cibilReqRaw) ? false : undefined,
    notes: str(r.notes) ?? str(r.policy_notes),
    circular_url: str(r.circular_url),
    checks: list(r.checks),
    city_specific: typeof r.city_specific === "string" ? ["yes", "true", "1", "y"].includes(String(r.city_specific).toLowerCase()) : undefined,
    variants: list(r.variants) ?? list(r.product_variants)
  };
  const clean = (o: Record<string, any>) => { const out: Record<string, any> = {}; for (const k of Object.keys(o)) if (o[k] !== undefined && o[k] !== null && o[k] !== "") out[k] = o[k]; return out; };
  const rate = num(r.rate) ?? 0;
  const productByName = new Map((await q<{ id: number; name: string }>("SELECT id, name FROM gn_products WHERE tenant_id = ?", [t]) ?? []).map((x) => [x.name, x.id]));
  const productId = r.product_id ? Number(r.product_id) : (r.product_name ? productByName.get(r.product_name) : null);
  return (await run(
    `INSERT INTO gn_schemes (tenant_id, lender_id, product_id, name, payout_type, rate, flat_amount, slabs, effective_from, effective_to, status, profile, states, loan_params, eligibility, programs, purposes, usp, commission_pct, policy, source, notes, banker_name, banker_email, banker_phone, branch, sub_product)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [t, lenderId, productId, r.name, str(r.payout_type) ?? "percent", rate, num(r.flat_amount) ?? 0, JSON.stringify([]),
     str(r.effective_from) ?? str(r.effective_date), str(r.effective_to), str(r.status) ?? "active", str(r.profile),
     JSON.stringify(list(r.states)), JSON.stringify(clean(loanParams)), JSON.stringify(clean(eligibility)),
     JSON.stringify(list(r.programs)), JSON.stringify(list(r.purposes)), str(r.usp),
     num(r.commission_pct) ?? num(r.commission) ?? rate, JSON.stringify(clean(policy)), source, str(r.notes),
     str(r.banker_name), str(r.banker_email), str(r.banker_phone), str(r.branch), str(r.sub_product)]
  )).lastId;
}

/** Import scheme rows OR store a scheme document — accepts CSV, TSV, JSON, Excel (.xlsx/.xls), PDF, images and any other document format. */
gnAdminRouter.post("/gn/import/schemes/file", requirePerm("gn.*"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const b = z.object({ filename: z.string().min(1), mime: z.string().optional(), data: z.string() }).parse(req.body);
  const buf = Buffer.from(b.data, "base64");
  const ext = (b.filename.split(".").pop() || "").toLowerCase();
  const lenderByName = new Map((await q<{ id: number; name: string }>("SELECT id, name FROM gn_lenders WHERE tenant_id = ?", [t]) ?? []).map((r) => [r.name, r.id]));
  const inserted: number[] = [];
  const errors: { row: number; error: string }[] = [];
  let format = ext;
  let pending = false;
  let notes: string | null = null;
  try {
    if (["csv", "tsv"].includes(ext)) {
      const text = buf.toString("utf8").replace(/^\uFEFF/, "");
      const rows = parseCsv(ext === "tsv" ? text.replace(/\t/g, ",") : text);
      for (const [i, row] of rows.entries()) {
        try { inserted.push(await importSchemeRow(t, row, lenderByName, `import:${ext}`)); }
        catch (e) { errors.push({ row: i + 1, error: (e as Error).message }); }
      }
    } else if (ext === "json") {
      const parsed = JSON.parse(buf.toString("utf8"));
      const rows: Record<string, any>[] = Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
      for (const [i, row] of rows.entries()) {
        try { inserted.push(await importSchemeRow(t, row, lenderByName, "import:json")); }
        catch (e) { errors.push({ row: i + 1, error: (e as Error).message }); }
      }
    } else if (["xlsx", "xls"].includes(ext)) {
      const wb = XLSX.read(buf, { type: "buffer" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
      for (const [i, row] of rows.entries()) {
        try { inserted.push(await importSchemeRow(t, row, lenderByName, "import:xlsx")); }
        catch (e) { errors.push({ row: i + 1, error: (e as Error).message }); }
      }
    } else {
      // PDF / images / any other document — stored as a scheme document for manual review
      pending = true;
      format = "document";
      notes = "Document stored — automatic text extraction is not available for this format in the demo. Review it and add the scheme via the form.";
      await run(
        "INSERT INTO gn_scheme_files (tenant_id, kind, filename, mime, size, content, status, notes) VALUES (?, 'scheme_document', ?, ?, ?, ?, 'pending_review', ?)",
        [t, b.filename, b.mime || "application/octet-stream", buf.length, b.data, notes]
      );
    }
  } catch (e) {
    return void res.status(400).json({ error: (e as Error).message });
  }
  const attachment = (await q1<{ id: number }>("SELECT id FROM gn_scheme_files WHERE tenant_id = ? ORDER BY id DESC LIMIT 1", [t]))?.id ?? null;
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.scheme.import_file", entityType: "gn_scheme_import", after: { filename: b.filename, format, inserted: inserted.length, errors: errors.length, pending }, ip: clientIp(req) });
  res.json({ ok: true, format, filename: b.filename, inserted: inserted.length, errors, pending, attachment, notes });
}));

