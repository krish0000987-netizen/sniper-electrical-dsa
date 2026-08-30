import { Router } from "express";
import { z } from "zod";
import { q, q1, run } from "../db/connection.js";
import { audit } from "../core/audit.js";
import { hashPassword, ROLES, ROLE_LABELS } from "../core/auth.js";
import { asyncH, authRequired, clientIp, requirePerm, type AuthedRequest } from "../middleware.js";
import { evaluateRuleSet, renderCondition, type BreRule } from "../core/bre.js";
import { buildApplicationContext } from "../core/ctx.js";

export const adminRouter = Router();
adminRouter.use(authRequired);

/* ---------- USERS ---------- */

adminRouter.get("/users", requirePerm("admin.users"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT u.id, u.name, u.email, u.role, u.phone, u.active, u.last_login_at, u.created_at, b.name AS branch_name
     FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE u.tenant_id = ? ORDER BY u.id`, [req.user!.tenant_id]);
  res.json({ rows, roles: ROLES, roleLabels: ROLE_LABELS });
}));

adminRouter.post("/users", requirePerm("admin.users"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(4), role: z.string(), branch_id: z.number().nullable().optional(), phone: z.string().optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO users (tenant_id, branch_id, name, email, password_hash, role, phone) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [req.user!.tenant_id, body.branch_id ?? null, body.name, body.email.toLowerCase(), hashPassword(body.password), body.role, body.phone ?? null]
  )).lastId;
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "admin.user_create", entityType: "user", entityId: id, after: { name: body.name, role: body.role }, ip: clientIp(req) });
  res.json({ id });
}));

adminRouter.patch("/users/:id", requirePerm("admin.users"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ role: z.string().optional(), active: z.boolean().optional(), branch_id: z.number().nullable().optional(), name: z.string().optional() }).parse(req.body);
  const before = await q1("SELECT * FROM users WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!before) { res.status(404).json({ error: "User not found" }); return; }
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    sets.push(`${k} = ?`);
    params.push(v === undefined ? null : v);
  }
  params.push(req.params.id);
  await run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "admin.user_update", entityType: "user", entityId: before.id, before, after: body, ip: clientIp(req) });
  res.json({ ok: true });
}));

/* ---------- PRODUCTS ---------- */

adminRouter.get("/products", requirePerm("admin.products"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q("SELECT * FROM products WHERE tenant_id = ? ORDER BY id", [req.user!.tenant_id]);
  res.json(rows);
}));

const productSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(2),
  category: z.string(),
  min_amount: z.number().optional(),
  max_amount: z.number().optional(),
  min_tenure: z.number().optional(),
  max_tenure: z.number().optional(),
  interest_type: z.string().optional(),
  interest_rate: z.number().optional(),
  processing_fee_pct: z.number().optional(),
  processing_fee_gst_pct: z.number().optional(),
  penal_rate_pct: z.number().optional(),
  late_fee_amount: z.number().optional(),
  grace_days: z.number().optional(),
  prepayment_allowed: z.number().optional(),
  foreclosure_charge_pct: z.number().optional(),
  part_payment_allowed: z.number().optional(),
  part_payment_min_amount: z.number().optional(),
  emi_frequency: z.string().optional(),
  allocation_order: z.string().optional(),
  status: z.string().optional()
});

adminRouter.post("/products", requirePerm("admin.products"), asyncH(async (req: AuthedRequest, res) => {
  const body = productSchema.parse(req.body);
  const id = (await run(
    `INSERT INTO products (tenant_id, code, name, category, min_amount, max_amount, min_tenure, max_tenure, interest_type, interest_rate,
       processing_fee_pct, processing_fee_gst_pct, penal_rate_pct, late_fee_amount, grace_days, prepayment_allowed, foreclosure_charge_pct,
       part_payment_allowed, part_payment_min_amount, emi_frequency, allocation_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user!.tenant_id, body.code, body.name, body.category, body.min_amount ?? 10000, body.max_amount ?? 5000000,
     body.min_tenure ?? 6, body.max_tenure ?? 60, body.interest_type ?? "reducing", body.interest_rate ?? 16,
     body.processing_fee_pct ?? 2, body.processing_fee_gst_pct ?? 18, body.penal_rate_pct ?? 24, body.late_fee_amount ?? 0,
     body.grace_days ?? 3, body.prepayment_allowed ?? 1, body.foreclosure_charge_pct ?? 3, body.part_payment_allowed ?? 1,
     body.part_payment_min_amount ?? 10000, body.emi_frequency ?? "monthly", body.allocation_order ?? "penalty,fees,interest,principal"]
  )).lastId;
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "admin.product_create", entityType: "product", entityId: id, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM products WHERE id = ?", [id]));
}));

adminRouter.patch("/products/:id", requirePerm("admin.products"), asyncH(async (req: AuthedRequest, res) => {
  const body = productSchema.partial().parse(req.body);
  const before = await q1("SELECT * FROM products WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!before) { res.status(404).json({ error: "Product not found" }); return; }
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    sets.push(`${k} = ?`);
    params.push(v === undefined ? null : v);
  }
  params.push(req.params.id);
  await run(`UPDATE products SET ${sets.join(", ")} WHERE id = ?`, params);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "admin.product_update", entityType: "product", entityId: before.id, before, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM products WHERE id = ?", [before.id]));
}));

/* ---------- BRE RULES ---------- */

adminRouter.get("/bre/rules", requirePerm("bre.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>("SELECT * FROM bre_rules WHERE tenant_id = ? ORDER BY priority, id", [req.user!.tenant_id]);
  res.json(rows.map((r) => ({ ...r, conditions: JSON.parse(r.conditions), action: JSON.parse(r.action), rendered: renderCondition(JSON.parse(r.conditions)) })));
}));

const ruleSchema = z.object({
  code: z.string(),
  name: z.string().min(2),
  category: z.enum(["product", "credit_policy", "regulatory", "operational", "approval"]),
  priority: z.number().default(100),
  conditions: z.any(),
  action: z.any(),
  effective_from: z.string().optional(),
  expiry: z.string().optional(),
  status: z.enum(["draft", "active", "retired"]).default("draft")
});

adminRouter.post("/bre/rules", requirePerm("bre.edit"), asyncH(async (req: AuthedRequest, res) => {
  const body = ruleSchema.parse(req.body);
  const id = (await run(
    `INSERT INTO bre_rules (tenant_id, code, name, category, version, priority, conditions, action, effective_from, expiry, status, created_by)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user!.tenant_id, body.code, body.name, body.category, body.priority, JSON.stringify(body.conditions), JSON.stringify(body.action),
     body.effective_from ?? null, body.expiry ?? null, body.status, req.user!.id]
  )).lastId;
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "bre.rule_create", entityType: "bre_rule", entityId: id, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM bre_rules WHERE id = ?", [id]));
}));

adminRouter.post("/bre/rules/:id/activate", requirePerm("bre.activate"), asyncH(async (req: AuthedRequest, res) => {
  const rule = await q1<Record<string, any>>("SELECT * FROM bre_rules WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }
  const before = { ...rule };
  await run("UPDATE bre_rules SET status = 'active', approved_by = ? WHERE id = ?", [req.user!.id, rule.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "bre.rule_activate", entityType: "bre_rule", entityId: rule.id, before, after: { status: "active" }, ip: clientIp(req) });
  res.json({ ok: true });
}));

adminRouter.post("/bre/rules/:id/retire", requirePerm("bre.activate"), asyncH(async (req: AuthedRequest, res) => {
  await run("UPDATE bre_rules SET status = 'retired' WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "bre.rule_retire", entityType: "bre_rule", entityId: req.params.id, after: { status: "retired" }, ip: clientIp(req) });
  res.json({ ok: true });
}));

/** Policy simulator: evaluate a proposed rule change against live applications without applying it. */
adminRouter.post("/bre/simulate", requirePerm("bre.simulate"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ conditions: z.any(), action: z.any().optional() }).parse(req.body);
  const apps = await q<Record<string, any>>("SELECT id FROM applications WHERE tenant_id = ? AND status != 'rejected' LIMIT 300", [req.user!.tenant_id]);
  const results = await Promise.all(apps.map(async (a) => {
    const ctx = await buildApplicationContext(a.id);
    const rule: BreRule = { code: "SIM", name: "Simulated rule", category: "credit_policy", priority: 1, conditions: body.conditions, action: body.action ?? {} };
    const r = evaluateRuleSet([rule], ctx);
    return { applicationId: a.id, eligible: r.eligible, riskGrade: r.riskGrade, reason: r.reasons[0] };
  }));
  const affected = results.filter((r) => !r.eligible).length;
  res.json({ simulated: results.length, affected, impactPct: results.length ? Math.round((affected / results.length) * 1000) / 10 : 0, results: results.slice(0, 50) });
}));

/* ---------- WORKFLOW ---------- */

adminRouter.get("/workflow", requirePerm("admin.rules"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q("SELECT * FROM workflow_stages WHERE tenant_id = ? ORDER BY seq", [req.user!.tenant_id]);
  res.json(rows);
}));

adminRouter.patch("/workflow/:id", requirePerm("admin.rules"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ sla_hours: z.number().optional(), required_documents: z.any().optional(), required_fields: z.any().optional(), active: z.number().optional() }).parse(req.body);
  const before = await q1("SELECT * FROM workflow_stages WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!before) { res.status(404).json({ error: "Stage not found" }); return; }
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    sets.push(`${k} = ?`);
    params.push(typeof v === "object" ? JSON.stringify(v) : v);
  }
  params.push(req.params.id);
  await run(`UPDATE workflow_stages SET ${sets.join(", ")} WHERE id = ?`, params);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "admin.workflow_update", entityType: "workflow_stage", entityId: before.id, before, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM workflow_stages WHERE id = ?", [before.id]));
}));

/**
 * Visual workflow builder — replaces the active stage set for a product
 * (or the default product-less workflow) while preserving history: the old
 * rows are marked inactive, never deleted, so versions remain auditable.
 */
adminRouter.post("/workflow/save", requirePerm("admin.rules"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({
    product_id: z.number().nullable().optional(),
    stages: z.array(z.object({
      code: z.string(), name: z.string(), sla_hours: z.number().int().positive().default(24),
      required_fields: z.array(z.string()).optional(), required_documents: z.array(z.string()).optional(),
      approver_role: z.string().nullable().optional()
    })).min(2)
  }).parse(req.body);
  const productId = body.product_id ?? null;
  await run("UPDATE workflow_stages SET active = 0 WHERE tenant_id = ? AND product_id IS ?", [req.user!.tenant_id, productId]);
  for (const [i, s] of body.stages.entries()) {
    await run("INSERT INTO workflow_stages (tenant_id, product_id, code, name, seq, required_fields, required_documents, sla_hours, approver_role, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
      [req.user!.tenant_id, productId, s.code, s.name, i + 1, JSON.stringify(s.required_fields ?? []), JSON.stringify(s.required_documents ?? []), s.sla_hours, s.approver_role ?? null]);
  }
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "admin.workflow_save", entityType: "workflow", entityId: productId ?? 0, after: { product_id: productId, stages: body.stages.map((s) => s.code) }, ip: clientIp(req) });
  res.json({ ok: true, saved: body.stages.length });
}));

/* ---------- INTEGRATIONS ---------- */

adminRouter.get("/integrations", requirePerm("admin.integrations"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q("SELECT * FROM integrations WHERE tenant_id = ? ORDER BY category, id", [req.user!.tenant_id]);
  res.json(rows);
}));

adminRouter.patch("/integrations/:id", requirePerm("admin.integrations"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ status: z.enum(["connected", "sandbox", "error", "not_configured"]), provider: z.string().optional() }).parse(req.body);
  const before = await q1("SELECT * FROM integrations WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!before) { res.status(404).json({ error: "Integration not found" }); return; }
  await run("UPDATE integrations SET status = ?, provider = COALESCE(?, provider) WHERE id = ?", [body.status, body.provider ?? null, before.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "admin.integration_update", entityType: "integration", entityId: before.id, before, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM integrations WHERE id = ?", [before.id]));
}));

/* ---------- AUDIT ---------- */

adminRouter.get("/audit", requirePerm("audit.view"), asyncH(async (req: AuthedRequest, res) => {
  const { q: query, page = 1, limit = 50 } = req.query as Record<string, string>;
  const where = ["al.tenant_id = ?"];
  const params: unknown[] = [req.user!.tenant_id];
  if (query) { where.push("(al.action LIKE ? OR al.entity_type LIKE ?)"); params.push(`%${query}%`, `%${query}%`); }
  const total = (await q1<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_logs al WHERE ${where.join(" AND ")}`, params))!.n;
  const rows = await q<Record<string, any>>(
    `SELECT al.*, u.name AS by_name FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
     WHERE ${where.join(" AND ")} ORDER BY al.id DESC LIMIT ? OFFSET ?`,
    [...params, Number(limit), (Math.max(1, Number(page)) - 1) * Number(limit)]
  );
  res.json({ rows, total });
}));

/* ---------- COMPLIANCE ---------- */

adminRouter.get("/compliance", requirePerm("compliance.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = req.user!.tenant_id;
  const rules = await q("SELECT * FROM compliance_rules WHERE tenant_id = ? ORDER BY id", [t]);
  const consents = await q(
    `SELECT c.*, cu.name AS customer_name FROM consents c JOIN customers cu ON cu.id = c.customer_id
     WHERE c.tenant_id = ? ORDER BY c.id DESC LIMIT 30`, [t]);
  const complaints = await q(
    `SELECT cp.*, cu.name AS customer_name FROM complaints cp LEFT JOIN customers cu ON cu.id = cp.customer_id
     WHERE cp.tenant_id = ? ORDER BY cp.id DESC LIMIT 30`, [t]);
  const kyc = await q(
    `SELECT k.*, cu.name AS customer_name FROM kyc_records k JOIN customers cu ON cu.id = k.customer_id
     WHERE k.tenant_id = ? ORDER BY k.id DESC LIMIT 30`, [t]);
  const kycStats = await q1<Record<string, any>>(
    `SELECT SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed FROM kyc_records WHERE tenant_id = ?`, [t]);
  res.json({ rules, consents, complaints, kyc, kycStats });
}));

adminRouter.post("/complaints", requirePerm("complaints.*"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ customer_id: z.number(), category: z.string(), priority: z.string().optional(), subject: z.string(), description: z.string().optional() }).parse(req.body);
  const no = "GRV" + new Date().getFullYear().toString().slice(2) + String(Math.floor(10000 + Math.random() * 89999));
  const id = (await run(
    "INSERT INTO complaints (tenant_id, customer_id, complaint_no, category, priority, status, subject, description) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)",
    [req.user!.tenant_id, body.customer_id, no, body.category, body.priority ?? "medium", body.subject, body.description ?? null]
  )).lastId;
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "complaint.create", entityType: "complaint", entityId: id, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM complaints WHERE id = ?", [id]));
}));

adminRouter.patch("/complaints/:id", requirePerm("complaints.*"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ status: z.enum(["open", "in_progress", "resolved", "escalated", "closed"]), resolution: z.string().optional() }).parse(req.body);
  const before = await q1("SELECT * FROM complaints WHERE id = ?", [req.params.id]);
  if (!before) { res.status(404).json({ error: "Complaint not found" }); return; }
  await run("UPDATE complaints SET status = ?, resolution = COALESCE(?, resolution), resolved_at = CASE WHEN ? IN ('resolved','closed') THEN datetime('now') ELSE resolved_at END WHERE id = ?",
    [body.status, body.resolution ?? null, body.status, before.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: `complaint.${body.status}`, entityType: "complaint", entityId: before.id, before, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM complaints WHERE id = ?", [before.id]));
}));

/* ---------- SYSTEM CONFIG ---------- */

adminRouter.get("/config/:key", requirePerm("admin.rules"), asyncH(async (req: AuthedRequest, res) => {
  const row = await q1<Record<string, any>>("SELECT value FROM system_config WHERE tenant_id = ? AND key = ?", [req.user!.tenant_id, req.params.key]);
  res.json(row ? JSON.parse(row.value) : null);
}));

adminRouter.post("/config/:key", requirePerm("admin.rules"), asyncH(async (req: AuthedRequest, res) => {
  const before = await q1("SELECT * FROM system_config WHERE tenant_id = ? AND key = ?", [req.user!.tenant_id, req.params.key]);
  await run(
    `INSERT INTO system_config (tenant_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [req.user!.tenant_id, req.params.key, JSON.stringify(req.body)]
  );
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: `admin.config_${req.params.key}`, entityType: "system_config", entityId: before?.id ?? null, before, after: req.body, ip: clientIp(req) });
  res.json({ ok: true });
}));

/* ---------- HEALTH ---------- */

adminRouter.get("/health", asyncH(async (_req: AuthedRequest, res) => {
  const counts: Record<string, number> = {};
  for (const tbl of ["tenants", "users", "customers", "leads", "applications", "loans", "installments", "payments", "audit_logs", "bre_rules"]) {
    counts[tbl] = (await q1<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tbl}`))!.n;
  }
  res.json({ status: "ok", db: "sqlite", counts });
}));
