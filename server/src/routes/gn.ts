import { Router } from "express";
import { z } from "zod";
import { q, q1, run } from "../db/connection.js";
import { audit } from "../core/audit.js";
import { asyncH, authRequired, clientIp, requirePerm, type AuthedRequest } from "../middleware.js";
import { gnSettings } from "../core/gn.js";

export const gnRouter = Router();
gnRouter.use(authRequired);

const T = (req: AuthedRequest) => req.user!.tenant_id;

/* ================= DASHBOARD ================= */

gnRouter.get("/gn/dashboard", requirePerm("gn.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => await q1<T>(sql, params) as T;
  const apps = await one<{ total: number; submitted: number; approved: number; rejected: number; disbursed: number }>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN stage IN ('lender','agreement','disbursement','completed','closed') THEN 1 ELSE 0 END) AS submitted,
       SUM(CASE WHEN status IN ('approved','sanction_generated','agreement_pending','esign_pending','agreement_completed','disb_pending','disb_initiated','disb_partial','disb_fully','disb_confirmed','payout_pending','payout_received','closed') THEN 1 ELSE 0 END) AS approved,
       SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
       SUM(CASE WHEN disbursed_amount > 0 THEN 1 ELSE 0 END) AS disbursed
     FROM gn_applications WHERE tenant_id = ?`, [t]);
  const disbursement = await one<{ total: number }>("SELECT COALESCE(SUM(disbursed_amount), 0) AS total FROM gn_applications WHERE tenant_id = ? AND disbursed_amount > 0", [t]);
  const commissions = await one<{ gross: number; received: number; net: number }>(
    `SELECT COALESCE(SUM(gross), 0) AS gross, COALESCE(SUM(CASE WHEN status = 'received' THEN gross ELSE 0 END), 0) AS received,
       COALESCE(SUM(net), 0) AS net FROM gn_commissions WHERE tenant_id = ?`, [t]);
  const receivable = await one<{ total: number }>("SELECT COALESCE(SUM(gross), 0) AS total FROM gn_commissions WHERE tenant_id = ? AND status = 'earned'", [t]);
  const aging = await q<Record<string, any>>(
    `SELECT CASE WHEN julianday('now') - julianday(created_at) <= 30 THEN '0-30'
                 WHEN julianday('now') - julianday(created_at) <= 60 THEN '31-60'
                 WHEN julianday('now') - julianday(created_at) <= 90 THEN '61-90'
                 ELSE '90+' END AS bucket, COALESCE(SUM(gross), 0) AS amount, COUNT(*) AS n
     FROM gn_commissions WHERE tenant_id = ? AND status = 'earned' GROUP BY bucket`, [t]);
  const byLender = await q<Record<string, any>>(
    `SELECT l.name, COUNT(a.id) AS apps, COALESCE(SUM(a.disbursed_amount), 0) AS disbursed, COALESCE(SUM(a.commission_gross), 0) AS commission
     FROM gn_applications a JOIN gn_lenders l ON l.id = a.lender_id WHERE a.tenant_id = ?
     GROUP BY l.id ORDER BY disbursed DESC LIMIT 6`, [t]);
  const byPartner = await q<Record<string, any>>(
    `SELECT p.name, COUNT(a.id) AS apps, COALESCE(SUM(a.disbursed_amount), 0) AS disbursed
     FROM gn_applications a JOIN gn_partners p ON p.id = a.partner_id WHERE a.tenant_id = ?
     GROUP BY p.id ORDER BY disbursed DESC LIMIT 6`, [t]);
  const funnel = await q<Record<string, any>>(
    `SELECT stage, COUNT(*) AS n FROM gn_applications WHERE tenant_id = ? GROUP BY stage`, [t]);
  const trend = await q<Record<string, any>>(
    `SELECT substr(disbursed_at, 1, 7) AS month, COALESCE(SUM(disbursed_amount), 0) AS amount, COUNT(*) AS loans
     FROM gn_applications WHERE tenant_id = ? AND disbursed_amount > 0 GROUP BY month ORDER BY month DESC LIMIT 6`, [t]);
  const campaigns = await q<Record<string, any>>("SELECT * FROM gn_campaigns WHERE tenant_id = ? ORDER BY id DESC LIMIT 5", [t]);
  const partners = await one<{ n: number }>("SELECT COUNT(*) AS n FROM gn_partners WHERE tenant_id = ? AND status = 'active'", [t]);
  const settings = await gnSettings(t);
  res.json({
    applications: { ...apps, pending: (apps?.total ?? 0) - (apps?.submitted ?? 0) },
    disbursement: disbursement?.total ?? 0,
    commissions,
    receivable: receivable?.total ?? 0,
    aging, byLender, byPartner, funnel, trend: trend.reverse(), campaigns, activePartners: partners?.n ?? 0, settings
  });
}));

/* ================= LENDERS ================= */

gnRouter.get("/gn/lenders", requirePerm("gn.masters.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT l.*,
       (SELECT COUNT(*) FROM gn_products p WHERE p.lender_id = l.id) AS products,
       (SELECT COUNT(*) FROM gn_applications a WHERE a.lender_id = l.id) AS applications,
       (SELECT COALESCE(SUM(a.disbursed_amount), 0) FROM gn_applications a WHERE a.lender_id = l.id) AS disbursed
     FROM gn_lenders l WHERE l.tenant_id = ? ORDER BY l.name`, [T(req)]);
  res.json(rows);
}));

const lenderSchema = z.object({
  name: z.string().min(2), type: z.string().optional(), dsa_code: z.string().optional(),
  contact_person: z.string().optional(), contact_phone: z.string().optional(), contact_email: z.string().optional(),
  gst_policy: z.string().optional(), api_status: z.string().optional(), status: z.string().optional()
});

gnRouter.post("/gn/lenders", requirePerm("gn.masters.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = lenderSchema.parse(req.body);
  const id = (await run(
    "INSERT INTO gn_lenders (tenant_id, name, type, dsa_code, contact_person, contact_phone, contact_email, gst_policy, api_status, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [T(req), b.name, b.type ?? "Bank", b.dsa_code ?? null, b.contact_person ?? null, b.contact_phone ?? null, b.contact_email ?? null, b.gst_policy ?? "client", b.api_status ?? "mock", b.status ?? "active"]
  )).lastId;
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.lender.create", entityType: "gn_lender", entityId: id, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_lenders WHERE id = ?", [id]));
}));

gnRouter.patch("/gn/lenders/:id", requirePerm("gn.masters.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = lenderSchema.partial().parse(req.body);
  const before = await q1("SELECT * FROM gn_lenders WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!before) { res.status(404).json({ error: "Lender not found" }); return; }
  const sets = Object.keys(b).map((k) => `${k} = ?`);
  await run(`UPDATE gn_lenders SET ${sets.join(", ")} WHERE id = ?`, [...Object.values(b), before.id]);
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.lender.update", entityType: "gn_lender", entityId: before.id, before, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_lenders WHERE id = ?", [before.id]));
}));

/* ================= PRODUCTS ================= */

gnRouter.get("/gn/products", requirePerm("gn.masters.view"), asyncH(async (req: AuthedRequest, res) => {
  const { lender_id, category } = req.query as Record<string, string>;
  const where = ["p.tenant_id = ?"];
  const params: unknown[] = [T(req)];
  if (lender_id) { where.push("p.lender_id = ?"); params.push(Number(lender_id)); }
  if (category) { where.push("p.category = ?"); params.push(category); }
  const rows = await q<Record<string, any>>(
    `SELECT p.*, l.name AS lender_name FROM gn_products p JOIN gn_lenders l ON l.id = p.lender_id
     WHERE ${where.join(" AND ")} ORDER BY p.category, p.name`, params);
  const categories = await q<Record<string, any>>("SELECT category, COUNT(*) AS n FROM gn_products WHERE tenant_id = ? GROUP BY category ORDER BY n DESC", [T(req)]);
  res.json({ rows, categories });
}));

const productSchema = z.object({
  lender_id: z.number(), category: z.string().min(2), name: z.string().min(2), vertical: z.string().optional(),
  min_amount: z.number().optional(), max_amount: z.number().optional(), min_tenure: z.number().optional(), max_tenure: z.number().optional(),
  roi_min: z.number().nullable().optional(), roi_max: z.number().nullable().optional(),
  processing_fee_pct: z.number().optional(), payout_pct: z.number().optional(),
  min_turnover: z.number().nullable().optional(), min_vintage: z.number().nullable().optional(), min_income: z.number().nullable().optional(),
  geography: z.array(z.string()).optional(), required_documents: z.array(z.string()).optional(), status: z.string().optional()
});

gnRouter.post("/gn/products", requirePerm("gn.masters.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = productSchema.parse(req.body);
  const id = (await run(
    `INSERT INTO gn_products (tenant_id, lender_id, category, name, vertical, min_amount, max_amount, min_tenure, max_tenure,
       roi_min, roi_max, processing_fee_pct, payout_pct, min_turnover, min_vintage, min_income, geography, required_documents, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [T(req), b.lender_id, b.category, b.name, b.vertical ?? "fi", b.min_amount ?? 100000, b.max_amount ?? 50000000,
     b.min_tenure ?? 12, b.max_tenure ?? 120, b.roi_min ?? null, b.roi_max ?? null, b.processing_fee_pct ?? 0,
     b.payout_pct ?? 0, b.min_turnover ?? null, b.min_vintage ?? null, b.min_income ?? null,
     JSON.stringify(b.geography ?? []), JSON.stringify(b.required_documents ?? []), b.status ?? "active"]
  )).lastId;
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.product.create", entityType: "gn_product", entityId: id, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_products WHERE id = ?", [id]));
}));

/* ================= SCHEMES ================= */

gnRouter.get("/gn/schemes", requirePerm("gn.masters.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT s.*, l.name AS lender_name, p.name AS product_name, p.category AS product_category
     FROM gn_schemes s JOIN gn_lenders l ON l.id = s.lender_id LEFT JOIN gn_products p ON p.id = s.product_id
     WHERE s.tenant_id = ? ORDER BY s.id DESC`, [T(req)]);
  res.json(rows);
}));

// POST/PATCH /gn/schemes live in gn-admin.ts (extended Add Scheme with full loan params, eligibility, programs, policy).

/** Lender matching engine — routes a customer profile to eligible lender products. */
gnRouter.post("/gn/match", requirePerm("gn.view"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({
    loan_type: z.string().optional(), amount: z.number(), tenure: z.number().optional(),
    employment_type: z.string().optional(), monthly_income: z.number().nullable().optional(),
    business_turnover: z.number().nullable().optional(), business_vintage: z.number().nullable().optional(),
    city: z.string().optional(), state: z.string().optional()
  }).parse(req.body);
  const products = await q<Record<string, any>>(
    `SELECT p.*, l.name AS lender_name, l.api_status FROM gn_products p JOIN gn_lenders l ON l.id = p.lender_id
     WHERE p.tenant_id = ? AND p.status = 'active'`, [T(req)]);
  const matches = products.map((p) => {
    const reasons: string[] = [];
    let eligible = true;
    if (b.loan_type && p.category.toLowerCase() !== b.loan_type.toLowerCase() && !p.name.toLowerCase().includes(b.loan_type.toLowerCase())) {
      eligible = false; reasons.push(`Category ${p.category} ≠ requested ${b.loan_type}`);
    }
    if (b.amount < p.min_amount || b.amount > p.max_amount) { eligible = false; reasons.push(`Amount ₹${p.min_amount.toLocaleString("en-IN")}–₹${p.max_amount.toLocaleString("en-IN")}`); }
    if (b.business_turnover != null && p.min_turnover && b.business_turnover < p.min_turnover) { eligible = false; reasons.push(`Turnover below ₹${p.min_turnover.toLocaleString("en-IN")}`); }
    if (b.business_vintage != null && p.min_vintage && b.business_vintage < p.min_vintage) { eligible = false; reasons.push(`Vintage below ${p.min_vintage} yrs`); }
    if (b.monthly_income != null && p.min_income && b.monthly_income < p.min_income) { eligible = false; reasons.push(`Income below ₹${p.min_income.toLocaleString("en-IN")}/mo`); }
    let status: "eligible" | "additional_docs" | "not_eligible" = eligible ? "eligible" : "not_eligible";
    if (status === "eligible" && p.required_documents.length > 3) status = "additional_docs";
    return { product: p.name, category: p.category, lender: p.lender_name, api_status: p.api_status, payout_pct: p.payout_pct,
      roi: p.roi_min && p.roi_max ? `${p.roi_min}–${p.roi_max}%` : null, status, reasons: eligible ? [] : reasons };
  });
  res.json({ matches: matches.sort((a, b) => (a.status === "eligible" ? -1 : 1) - (b.status === "eligible" ? -1 : 1)) });
}));

/* ================= DSA CODES / PARENT DSAs / BANKERS ================= */

gnRouter.get("/gn/dsa-codes", requirePerm("gn.masters.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT c.*, l.name AS lender_name, pd.name AS parent_dsa_name FROM gn_dsa_codes c
     JOIN gn_lenders l ON l.id = c.lender_id LEFT JOIN gn_parent_dsas pd ON pd.id = c.parent_dsa_id
     WHERE c.tenant_id = ? ORDER BY c.id DESC`, [T(req)]);
  res.json(rows);
}));

gnRouter.post("/gn/dsa-codes", requirePerm("gn.masters.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ lender_id: z.number(), code: z.string().min(2), label: z.string().optional(), product_id: z.number().nullable().optional(), parent_dsa_id: z.number().nullable().optional(), via_parent: z.boolean().optional(), status: z.string().optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO gn_dsa_codes (tenant_id, lender_id, parent_dsa_id, code, label, product_id, via_parent, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [T(req), b.lender_id, b.parent_dsa_id ?? null, b.code, b.label ?? null, b.product_id ?? null, b.via_parent ? 1 : 0, b.status ?? "active"]
  )).lastId;
  res.json(await q1("SELECT * FROM gn_dsa_codes WHERE id = ?", [id]));
}));

gnRouter.get("/gn/parent-dsas", requirePerm("gn.masters.view"), asyncH(async (req: AuthedRequest, res) => {
  res.json(await q("SELECT * FROM gn_parent_dsas WHERE tenant_id = ? ORDER BY name", [T(req)]));
}));

gnRouter.get("/gn/bankers", requirePerm("gn.masters.view"), asyncH(async (req: AuthedRequest, res) => {
  res.json(await q("SELECT * FROM gn_bankers WHERE tenant_id = ? ORDER BY name", [T(req)]));
}));

gnRouter.post("/gn/bankers", requirePerm("gn.masters.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ name: z.string().min(2), bank: z.string().optional(), branch: z.string().optional(), city: z.string().optional(), role: z.string().optional(), phone: z.string().optional(), email: z.string().optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO gn_bankers (tenant_id, name, bank, branch, city, role, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [T(req), b.name, b.bank ?? null, b.branch ?? null, b.city ?? null, b.role ?? null, b.phone ?? null, b.email ?? null]
  )).lastId;
  res.json(await q1("SELECT * FROM gn_bankers WHERE id = ?", [id]));
}));

/* ================= PARTNERS & TEAM ================= */

gnRouter.get("/gn/partners", requirePerm("gn.masters.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT p.*, par.name AS parent_name,
       (SELECT COUNT(*) FROM gn_applications a WHERE a.partner_id = p.id) AS applications,
       (SELECT COALESCE(SUM(a.disbursed_amount), 0) FROM gn_applications a WHERE a.partner_id = p.id) AS disbursed
     FROM gn_partners p LEFT JOIN gn_partners par ON par.id = p.parent_id
     WHERE p.tenant_id = ? ORDER BY p.id`, [T(req)]);
  res.json(rows);
}));

const partnerSchema = z.object({
  name: z.string().min(2), type: z.string().optional(), phone: z.string().optional(), email: z.string().optional(),
  pan: z.string().optional(), gstin: z.string().optional(), commission_pct: z.number().optional(),
  parent_id: z.number().nullable().optional(), user_id: z.number().nullable().optional(), status: z.string().optional()
});

gnRouter.post("/gn/partners", requirePerm("gn.masters.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = partnerSchema.parse(req.body);
  const id = (await run(
    "INSERT INTO gn_partners (tenant_id, name, type, phone, email, pan, gstin, commission_pct, parent_id, user_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [T(req), b.name, b.type ?? "DSA", b.phone ?? null, b.email ?? null, b.pan ?? null, b.gstin ?? null, b.commission_pct ?? 0, b.parent_id ?? null, b.user_id ?? null, b.status ?? "active"]
  )).lastId;
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.partner.create", entityType: "gn_partner", entityId: id, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_partners WHERE id = ?", [id]));
}));

gnRouter.patch("/gn/partners/:id", requirePerm("gn.masters.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = partnerSchema.partial().parse(req.body);
  const before = await q1("SELECT * FROM gn_partners WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!before) { res.status(404).json({ error: "Partner not found" }); return; }
  const sets = Object.keys(b).map((k) => `${k} = ?`);
  await run(`UPDATE gn_partners SET ${sets.join(", ")} WHERE id = ?`, [...Object.values(b), before.id]);
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.partner.update", entityType: "gn_partner", entityId: before.id, before, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_partners WHERE id = ?", [before.id]));
}));

/* ================= HR ================= */

gnRouter.get("/gn/team", requirePerm("gn.hr.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.active,
       (SELECT COUNT(*) FROM gn_applications a WHERE a.assigned_to = u.id) AS applications,
       (SELECT COALESCE(SUM(a.disbursed_amount), 0) FROM gn_applications a WHERE a.assigned_to = u.id) AS disbursed
     FROM users u WHERE u.tenant_id = ? ORDER BY u.name`, [T(req)]);
  res.json(rows);
}));

gnRouter.get("/gn/hr/leave", requirePerm("gn.hr.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT lr.*, u.name AS user_name FROM gn_leave_requests lr JOIN users u ON u.id = lr.user_id
     WHERE lr.tenant_id = ? ORDER BY lr.id DESC`, [T(req)]);
  res.json(rows);
}));

gnRouter.post("/gn/hr/leave", requirePerm("gn.hr.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ user_id: z.number(), leave_type: z.string().optional(), from_date: z.string(), to_date: z.string(), days: z.number(), reason: z.string().optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO gn_leave_requests (tenant_id, user_id, leave_type, from_date, to_date, days, reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [T(req), b.user_id, b.leave_type ?? "casual", b.from_date, b.to_date, b.days, b.reason ?? null]
  )).lastId;
  res.json(await q1("SELECT * FROM gn_leave_requests WHERE id = ?", [id]));
}));

gnRouter.patch("/gn/hr/leave/:id", requirePerm("gn.hr.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ status: z.enum(["pending", "approved", "rejected"]), note: z.string().optional() }).parse(req.body);
  const before = await q1("SELECT * FROM gn_leave_requests WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!before) { res.status(404).json({ error: "Leave request not found" }); return; }
  await run("UPDATE gn_leave_requests SET status = ?, decided_by = ? WHERE id = ?", [b.status, req.user!.id, before.id]);
  await audit({ tenantId: T(req), userId: req.user!.id, action: `gn.hr.leave.${b.status}`, entityType: "gn_leave", entityId: before.id, before, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_leave_requests WHERE id = ?", [before.id]));
}));

gnRouter.get("/gn/hr/attendance", requirePerm("gn.hr.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT a.*, u.name AS user_name FROM gn_attendance a JOIN users u ON u.id = a.user_id
     WHERE a.tenant_id = ? ORDER BY a.date DESC LIMIT 200`, [T(req)]);
  const summary = await q<Record<string, any>>(
    `SELECT status, COUNT(*) AS n FROM gn_attendance WHERE tenant_id = ? GROUP BY status`, [T(req)]);
  res.json({ rows, summary });
}));

gnRouter.get("/gn/hr/payroll", requirePerm("gn.hr.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT p.*, u.name AS user_name, u.role FROM gn_payroll p JOIN users u ON u.id = p.user_id
     WHERE p.tenant_id = ? ORDER BY p.month DESC, u.name`, [T(req)]);
  res.json(rows);
}));

gnRouter.post("/gn/hr/payroll/generate", requirePerm("gn.hr.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ month: z.string() }).parse(req.body);
  const users = await q<Record<string, any>>("SELECT id, role FROM users WHERE tenant_id = ?", [T(req)]);
  let n = 0;
  for (const u of users) {
    const roleBase: Record<string, number> = { tenant_admin: 120000, branch_admin: 90000, sales_manager: 70000, credit_manager: 95000, credit_analyst: 65000, underwriter: 65000, operations: 55000, collection_manager: 55000, collection_agent: 30000, telecaller: 22000, field_executive: 30000, finance: 60000, dsa: 0, auditor: 70000, compliance_officer: 75000, customer_support: 25000, customer: 0 };
    const gross = roleBase[u.role] ?? 40000;
    if (gross === 0) continue;
    const tds = Math.round(gross * 0.02);
    await run(
      "INSERT OR IGNORE INTO gn_payroll (tenant_id, user_id, month, basic, hra, allowance, gross, tds, net) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [T(req), u.id, b.month, Math.round(gross * 0.5), Math.round(gross * 0.3), Math.round(gross * 0.2), gross, tds, gross - tds]
    );
    n++;
  }
  res.json({ generated: n, month: b.month });
}));

gnRouter.get("/gn/hr/recruitment", requirePerm("gn.hr.view"), asyncH(async (req: AuthedRequest, res) => {
  res.json(await q("SELECT * FROM gn_candidates WHERE tenant_id = ? ORDER BY id DESC", [T(req)]));
}));

gnRouter.post("/gn/hr/recruitment", requirePerm("gn.hr.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ name: z.string().min(2), position: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), source: z.string().optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO gn_candidates (tenant_id, name, position, phone, email, source) VALUES (?, ?, ?, ?, ?, ?)",
    [T(req), b.name, b.position ?? null, b.phone ?? null, b.email ?? null, b.source ?? null]
  )).lastId;
  res.json(await q1("SELECT * FROM gn_candidates WHERE id = ?", [id]));
}));

/* ================= MARKETING ================= */

gnRouter.get("/gn/campaigns", requirePerm("gn.marketing.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>("SELECT * FROM gn_campaigns WHERE tenant_id = ? ORDER BY id DESC", [T(req)]);
  const totals = await q1<Record<string, any>>(
    `SELECT COALESCE(SUM(spend), 0) AS spend, COALESCE(SUM(leads), 0) AS leads, COALESCE(SUM(applications), 0) AS applications,
       COALESCE(SUM(disbursed_amount), 0) AS disbursed FROM gn_campaigns WHERE tenant_id = ?`, [T(req)])!;
  res.json({ rows, totals: { ...totals, cpl: totals.leads > 0 ? Math.round(totals.spend / totals.leads) : 0, roi: totals.spend > 0 ? Math.round((totals.disbursed / totals.spend) * 100) / 100 : 0 } });
}));

gnRouter.post("/gn/campaigns", requirePerm("gn.marketing.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ name: z.string().min(2), channel: z.string().optional(), spend: z.number().optional(), leads: z.number().optional(), applications: z.number().optional(), disbursed_amount: z.number().optional(), start_date: z.string().nullable().optional(), end_date: z.string().nullable().optional(), status: z.string().optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO gn_campaigns (tenant_id, name, channel, spend, leads, applications, disbursed_amount, start_date, end_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [T(req), b.name, b.channel ?? "meta", b.spend ?? 0, b.leads ?? 0, b.applications ?? 0, b.disbursed_amount ?? 0, b.start_date ?? null, b.end_date ?? null, b.status ?? "active"]
  )).lastId;
  res.json(await q1("SELECT * FROM gn_campaigns WHERE id = ?", [id]));
}));

/* ================= DOCUMENTS ================= */

gnRouter.get("/gn/documents", requirePerm("gn.documents.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT d.*, u.name AS uploaded_by_name, v.name AS verified_by_name FROM gn_documents d
     LEFT JOIN users u ON u.id = d.uploaded_by LEFT JOIN users v ON v.id = d.verified_by
     WHERE d.tenant_id = ? ORDER BY d.id DESC LIMIT 300`, [T(req)]);
  const summary = await q<Record<string, any>>("SELECT status, COUNT(*) AS n FROM gn_documents WHERE tenant_id = ? GROUP BY status", [T(req)]);
  res.json({ rows, summary });
}));

gnRouter.post("/gn/documents", requirePerm("gn.documents.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ entity_type: z.enum(["customer", "application", "partner", "payout"]), entity_id: z.number(), doc_type: z.string(), name: z.string().optional(), status: z.string().optional(), expiry: z.string().nullable().optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO gn_documents (tenant_id, entity_type, entity_id, doc_type, name, status, uploaded_by, expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [T(req), b.entity_type, b.entity_id, b.doc_type, b.name ?? null, b.status ?? "uploaded", req.user!.id, b.expiry ?? null]
  )).lastId;
  res.json(await q1("SELECT * FROM gn_documents WHERE id = ?", [id]));
}));

gnRouter.patch("/gn/documents/:id", requirePerm("gn.documents.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ status: z.string() }).parse(req.body);
  const before = await q1("SELECT * FROM gn_documents WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!before) { res.status(404).json({ error: "Document not found" }); return; }
  await run("UPDATE gn_documents SET status = ?, verified_by = ?, verified_at = datetime('now') WHERE id = ?", [b.status, req.user!.id, before.id]);
  res.json(await q1("SELECT * FROM gn_documents WHERE id = ?", [before.id]));
}));

/* ================= TASKS ================= */

gnRouter.get("/gn/tasks", requirePerm("gn.tasks.view"), asyncH(async (req: AuthedRequest, res) => {
  const { status } = req.query as Record<string, string>;
  const where = ["t.tenant_id = ?"];
  const params: unknown[] = [T(req)];
  if (status) { where.push("t.status = ?"); params.push(status); }
  const rows = await q<Record<string, any>>(
    `SELECT t.*, u.name AS assigned_name FROM gn_tasks t
     LEFT JOIN users u ON u.id = t.assigned_to
     WHERE ${where.join(" AND ")} ORDER BY CASE t.status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, t.due_at`, params);
  const summary = await q<Record<string, any>>(
    "SELECT status, COUNT(*) AS n FROM gn_tasks WHERE tenant_id = ? GROUP BY status", [T(req)]);
  res.json({ rows, summary });
}));

gnRouter.post("/gn/tasks", requirePerm("gn.tasks.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ title: z.string().min(2), linked_to: z.string().optional(), priority: z.string().optional(), status: z.string().optional(), due_at: z.string().nullable().optional(), assigned_to: z.number().nullable().optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO gn_tasks (tenant_id, title, linked_to, priority, status, due_at, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [T(req), b.title, b.linked_to ?? null, b.priority ?? "medium", b.status ?? "pending", b.due_at ?? null, b.assigned_to ?? null, req.user!.id]
  )).lastId;
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.task.create", entityType: "gn_task", entityId: id, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_tasks WHERE id = ?", [id]));
}));

gnRouter.patch("/gn/tasks/:id", requirePerm("gn.tasks.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ status: z.string().optional(), priority: z.string().optional() }).parse(req.body);
  const before = await q1("SELECT * FROM gn_tasks WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!before) { res.status(404).json({ error: "Task not found" }); return; }
  await run("UPDATE gn_tasks SET status = COALESCE(?, status), priority = COALESCE(?, priority) WHERE id = ?", [b.status ?? null, b.priority ?? null, before.id]);
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.task.update", entityType: "gn_task", entityId: before.id, before: { status: before.status }, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_tasks WHERE id = ?", [before.id]));
}));

/* ================= UTILITY ================= */

/** Hub overview — counts powering every Utility dashboard tile (approvals, tasks, documents, imports). */
gnRouter.get("/gn/utility/overview", requirePerm("gn.utility.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await q1<T>(sql, params) as T) ?? ({} as T);
  const leavePending = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM gn_leave_requests WHERE tenant_id = ? AND status = 'pending'", [t])).n ?? 0;
  const claimsPending = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM gn_expenses WHERE tenant_id = ? AND status = 'pending'", [t])).n ?? 0;
  const claimsValue = (await one<{ v: number }>("SELECT COALESCE(SUM(amount), 0) AS v FROM gn_expenses WHERE tenant_id = ? AND status = 'pending'", [t])).v ?? 0;
  const tasksOpen = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM gn_tasks WHERE tenant_id = ? AND status != 'completed'", [t])).n ?? 0;
  const documents = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM gn_documents WHERE tenant_id = ?", [t])).n ?? 0;
  const docsPending = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM gn_documents WHERE tenant_id = ? AND status IN ('pending','uploaded','under_review')", [t])).n ?? 0;
  const leads = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM leads WHERE tenant_id = ?", [t])).n ?? 0;
  const leadsOpen = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM leads WHERE tenant_id = ? AND status IN ('new','assigned','contacted','followup','interested')", [t])).n ?? 0;
  const team = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?", [t])).n ?? 0;
  const imports = await q<Record<string, any>>(
    `SELECT id, action, entity_type, after, created_at FROM audit_logs WHERE tenant_id = ? AND action LIKE 'gn.import%' ORDER BY id DESC LIMIT 8`, [t]);
  const leadStatuses = await q<Record<string, any>>("SELECT status, COUNT(*) AS n FROM leads WHERE tenant_id = ? GROUP BY status ORDER BY n DESC", [t]);
  res.json({ leavePending, claimsPending, claimsValue, tasksOpen, documents, docsPending, leads, leadsOpen, team, imports, leadStatuses });
}));

/** Bulk lead assign — reassign every lead matching the filters to one team member (dry-run preview supported). */
gnRouter.post("/gn/utility/leads/assign", requirePerm("gn.leads.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const b = z.object({
    status: z.string().optional(), city: z.string().optional(), state: z.string().optional(),
    loan_type: z.string().optional(), assigned_to: z.number().nullable().optional(), search: z.string().optional(),
    target_user_id: z.number().int().positive(), dry_run: z.boolean().optional()
  }).parse(req.body);
  const where = ["l.tenant_id = ?"];
  const params: unknown[] = [t];
  if (b.status) { where.push("l.status = ?"); params.push(b.status); }
  if (b.city) { where.push("l.city = ?"); params.push(b.city); }
  if (b.state) { where.push("l.state = ?"); params.push(b.state); }
  if (b.loan_type) { where.push("l.loan_type = ?"); params.push(b.loan_type); }
  if (b.assigned_to) { where.push("l.owner_id = ?"); params.push(b.assigned_to); }
  if (b.search) { where.push("(l.name LIKE ? OR l.mobile LIKE ? OR l.email LIKE ?)"); const like = `%${b.search}%`; params.push(like, like, like); }
  const target = await q1<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ? AND tenant_id = ?", [b.target_user_id, t]);
  if (!target) { res.status(400).json({ error: "Target team member not found" }); return; }
  const affected = await q1<{ n: number; amount: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(l.requested_amount), 0) AS amount FROM leads l WHERE ${where.join(" AND ")}`, params)!;
  if (b.dry_run) {
    res.json({ dryRun: true, count: affected?.n ?? 0, amount: affected?.amount ?? 0, target: target.name });
    return;
  }
  const match = await q<{ id: number }>(`SELECT l.id FROM leads l WHERE ${where.join(" AND ")}`, params);
  for (const row of match) {
    await run("UPDATE leads SET owner_id = ?, updated_at = datetime('now') WHERE id = ?", [b.target_user_id, row.id]);
  }
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.utility.leads.assign", entityType: "lead", entityId: 0, before: b, after: { count: match.length, target: target.name }, ip: clientIp(req) });
  res.json({ assigned: match.length, target: target.name });
}));

/* ================= MARKETING — WORKFLOW BUILDER ================= */

gnRouter.get("/gn/workflows", requirePerm("gn.marketing.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT w.*, u.name AS created_name FROM gn_workflows w LEFT JOIN users u ON u.id = w.created_by
     WHERE w.tenant_id = ? ORDER BY w.id DESC`, [T(req)]);
  const summary = await q<Record<string, any>>("SELECT status, COUNT(*) AS n FROM gn_workflows WHERE tenant_id = ? GROUP BY status", [T(req)]);
  res.json({ rows, summary });
}));

gnRouter.post("/gn/workflows", requirePerm("gn.marketing.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ name: z.string().min(2), trigger: z.string().optional(), trigger_detail: z.string().optional(), route: z.string().optional(), actions: z.array(z.any()).optional(), status: z.string().optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO gn_workflows (tenant_id, name, trigger, trigger_detail, route, actions, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [T(req), b.name, b.trigger ?? "lead_captured", b.trigger_detail ?? null, b.route ?? "score_round_robin", JSON.stringify(b.actions ?? []), b.status ?? "draft", req.user!.id]
  )).lastId;
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.workflow.create", entityType: "gn_workflow", entityId: id, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_workflows WHERE id = ?", [id]));
}));

gnRouter.patch("/gn/workflows/:id", requirePerm("gn.marketing.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ name: z.string().optional(), trigger: z.string().optional(), trigger_detail: z.string().nullable().optional(), route: z.string().optional(), actions: z.array(z.any()).optional(), status: z.string().optional() }).parse(req.body);
  const before = await q1("SELECT * FROM gn_workflows WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!before) { res.status(404).json({ error: "Workflow not found" }); return; }
  const sets = Object.keys(b).map((k) => `${k} = ?`);
  const params = Object.entries(b).map(([k, v]) => (k === "actions" ? JSON.stringify(v) : v));
  await run(`UPDATE gn_workflows SET ${sets.join(", ")} WHERE id = ?`, [...params, before.id]);
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.workflow.update", entityType: "gn_workflow", entityId: before.id, before, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_workflows WHERE id = ?", [before.id]));
}));

/** Execute a workflow — demo run: enqueues its actions as outbound inbox messages + tasks and bumps counters. */
gnRouter.post("/gn/workflows/:id/run", requirePerm("gn.marketing.manage"), asyncH(async (req: AuthedRequest, res) => {
  const w = await q1<Record<string, any>>("SELECT * FROM gn_workflows WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!w) { res.status(404).json({ error: "Workflow not found" }); return; }
  const actions: any[] = JSON.parse(w.actions || "[]");
  const leads = await q<Record<string, any>>(
    `SELECT id, name, mobile FROM leads WHERE tenant_id = ? AND status IN ('new','assigned','contacted') LIMIT 3`, [T(req)]);
  let enqueued = 0;
  for (const l of leads) {
    for (const a of actions) {
      if (a.type === "whatsapp" || a.type === "email") {
        const tpl = a.template_id ? await q1<{ name: string; body: string }>("SELECT name, body FROM gn_message_templates WHERE id = ? AND tenant_id = ?", [a.template_id, T(req)]) : null;
        await run(
          "INSERT INTO gn_inbox_messages (tenant_id, direction, channel, to_contact, subject, body, related_type, related_id, status, created_by) VALUES (?, 'out', ?, ?, ?, ?, 'lead', ?, 'sent', ?)",
          [T(req), a.type === "whatsapp" ? "whatsapp" : "email", l.mobile, tpl?.name ?? w.name, tpl?.body ?? `Hi ${l.name}, your loan journey with Growth Nations is moving forward.`, l.id, req.user!.id]
        );
        enqueued++;
      }
      if (a.type === "task") {
        await run("INSERT INTO gn_tasks (tenant_id, title, linked_to, priority, status, due_at, assigned_to, created_by) VALUES (?, ?, ?, 'high', 'pending', datetime('now', '+1 day'), ?, ?)",
          [T(req), a.title ?? `Follow up ${l.name}`, `lead-${l.id}`, req.user!.id, req.user!.id]);
        enqueued++;
      }
    }
  }
  await run("UPDATE gn_workflows SET run_count = run_count + 1, last_run_at = datetime('now') WHERE id = ?", [w.id]);
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.workflow.run", entityType: "gn_workflow", entityId: w.id, after: { leads: leads.length, enqueued }, ip: clientIp(req) });
  res.json({ ok: true, leads: leads.length, enqueued, runCount: (w.run_count ?? 0) + 1 });
}));

/* ================= MARKETING — IVR & CALL LOGS ================= */

gnRouter.get("/gn/ivr/menus", requirePerm("gn.marketing.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT m.*, (SELECT COUNT(*) FROM gn_call_logs c WHERE c.ivr_menu_id = m.id) AS calls
     FROM gn_ivr_menus m WHERE m.tenant_id = ? ORDER BY m.id`, [T(req)]);
  res.json(rows);
}));

gnRouter.post("/gn/ivr/menus", requirePerm("gn.marketing.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ name: z.string().min(2), greeting: z.string().optional(), menu_options: z.array(z.any()).optional(), fallback: z.string().optional(), status: z.string().optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO gn_ivr_menus (tenant_id, name, greeting, menu_options, fallback, status) VALUES (?, ?, ?, ?, ?, ?)",
    [T(req), b.name, b.greeting ?? null, JSON.stringify(b.menu_options ?? []), b.fallback ?? "Telecalling", b.status ?? "active"]
  )).lastId;
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.ivr.menu.create", entityType: "gn_ivr_menu", entityId: id, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_ivr_menus WHERE id = ?", [id]));
}));

gnRouter.patch("/gn/ivr/menus/:id", requirePerm("gn.marketing.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ name: z.string().optional(), greeting: z.string().nullable().optional(), menu_options: z.array(z.any()).optional(), fallback: z.string().optional(), status: z.string().optional() }).parse(req.body);
  const before = await q1("SELECT * FROM gn_ivr_menus WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!before) { res.status(404).json({ error: "IVR menu not found" }); return; }
  const sets = Object.keys(b).map((k) => `${k} = ?`);
  const params = Object.entries(b).map(([k, v]) => (k === "menu_options" ? JSON.stringify(v) : v));
  await run(`UPDATE gn_ivr_menus SET ${sets.join(", ")} WHERE id = ?`, [...params, before.id]);
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.ivr.menu.update", entityType: "gn_ivr_menu", entityId: before.id, before, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_ivr_menus WHERE id = ?", [before.id]));
}));

gnRouter.get("/gn/ivr/calls", requirePerm("gn.marketing.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT c.*, m.name AS ivr_name FROM gn_call_logs c LEFT JOIN gn_ivr_menus m ON m.id = c.ivr_menu_id
     WHERE c.tenant_id = ? ORDER BY c.id DESC LIMIT 200`, [T(req)]);
  const summary = await q<Record<string, any>>("SELECT outcome, COUNT(*) AS n FROM gn_call_logs WHERE tenant_id = ? GROUP BY outcome", [T(req)]);
  res.json({ rows, summary });
}));

/** Simulate an inbound IVR call — routes by menu option, records the call and opens an inbox thread. */
gnRouter.post("/gn/ivr/calls", requirePerm("gn.marketing.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const b = z.object({ caller: z.string().optional(), ivr_menu_id: z.number().int().positive(), option: z.string().optional(), outcome: z.string().optional(), duration_sec: z.number().optional() }).parse(req.body);
  const menu = await q1<Record<string, any>>("SELECT * FROM gn_ivr_menus WHERE id = ? AND tenant_id = ?", [b.ivr_menu_id, t]);
  if (!menu) { res.status(404).json({ error: "IVR menu not found" }); return; }
  const options: any[] = JSON.parse(menu.menu_options || "[]");
  const picked = options.find((o) => o.key === b.option) ?? null;
  const route = picked?.route ?? menu.fallback ?? "Telecalling";
  const outcome = b.outcome ?? "connected";
  const caller = b.caller ?? `9XXXXXXXX${String(Math.floor(Math.random() * 90) + 10)}`;
  const seq = ((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM gn_call_logs WHERE tenant_id = ?", [t]))?.n ?? 0) + 1;
  const callId = `IVR-${new Date().getFullYear()}-${String(1000 + seq)}`;
  const id = (await run(
    "INSERT INTO gn_call_logs (tenant_id, call_id, caller, ivr_menu_id, route, outcome, duration_sec) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [t, callId, caller, menu.id, route, outcome, b.duration_sec ?? Math.round(Math.random() * 120) + 20]
  )).lastId;
  await run("UPDATE gn_ivr_menus SET call_count = call_count + 1 WHERE id = ?", [menu.id]);
  await run(
    "INSERT INTO gn_inbox_messages (tenant_id, direction, channel, from_contact, subject, body, related_type, status) VALUES (?, 'in', 'call', ?, ?, ?, 'lead', 'unread')",
    [t, caller, `IVR ${route}`, `${caller} pressed ${picked?.key ?? "?"} (${picked?.label ?? "no option"}) → routed to ${route}.`]
  );
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.ivr.call", entityType: "gn_call_log", entityId: id, after: { callId, route, outcome }, ip: clientIp(req) });
  res.json({ id, call_id: callId, caller, route, outcome, menu: menu.name });
}));

/* ================= INBOX ================= */

gnRouter.get("/gn/inbox", requirePerm("gn.inbox.view"), asyncH(async (req: AuthedRequest, res) => {
  const { channel, direction, status, q: search } = req.query as Record<string, string>;
  const where = ["m.tenant_id = ?"];
  const params: unknown[] = [T(req)];
  if (channel) { where.push("m.channel = ?"); params.push(channel); }
  if (direction) { where.push("m.direction = ?"); params.push(direction); }
  if (status) { where.push("m.status = ?"); params.push(status); }
  if (search) { where.push("(m.body LIKE ? OR m.from_contact LIKE ? OR m.subject LIKE ?)"); const like = `%${search}%`; params.push(like, like, like); }
  const rows = await q<Record<string, any>>(
    `SELECT m.*, u.name AS created_name FROM gn_inbox_messages m LEFT JOIN users u ON u.id = m.created_by
     WHERE ${where.join(" AND ")} ORDER BY m.id DESC LIMIT 300`, params);
  const summary = await q<Record<string, any>>("SELECT channel, status, direction, COUNT(*) AS n FROM gn_inbox_messages WHERE tenant_id = ? GROUP BY channel, status, direction", [T(req)]);
  res.json({ rows, summary });
}));

gnRouter.post("/gn/inbox", requirePerm("gn.inbox.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ direction: z.string().optional(), channel: z.string().optional(), from_contact: z.string().nullable().optional(), to_contact: z.string().nullable().optional(), subject: z.string().nullable().optional(), body: z.string().min(1), related_type: z.string().nullable().optional(), related_id: z.number().nullable().optional(), status: z.string().optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO gn_inbox_messages (tenant_id, direction, channel, from_contact, to_contact, subject, body, related_type, related_id, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [T(req), b.direction ?? "out", b.channel ?? "whatsapp", b.from_contact ?? null, b.to_contact ?? null, b.subject ?? null, b.body, b.related_type ?? null, b.related_id ?? null, b.status ?? (b.direction === "out" ? "sent" : "unread"), req.user!.id]
  )).lastId;
  res.json(await q1("SELECT * FROM gn_inbox_messages WHERE id = ?", [id]));
}));

gnRouter.patch("/gn/inbox/:id", requirePerm("gn.inbox.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ status: z.string().optional(), body: z.string().optional() }).parse(req.body);
  const before = await q1("SELECT * FROM gn_inbox_messages WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!before) { res.status(404).json({ error: "Message not found" }); return; }
  const sets = Object.keys(b).map((k) => `${k} = ?`);
  await run(`UPDATE gn_inbox_messages SET ${sets.join(", ")} WHERE id = ?`, [...Object.values(b), before.id]);
  res.json(await q1("SELECT * FROM gn_inbox_messages WHERE id = ?", [before.id]));
}));

/* ================= INBOX — TEMPLATES ================= */

gnRouter.get("/gn/inbox/templates", requirePerm("gn.inbox.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT mt.*, u.name AS created_name FROM gn_message_templates mt LEFT JOIN users u ON u.id = mt.created_by
     WHERE mt.tenant_id = ? ORDER BY mt.id DESC`, [T(req)]);
  const summary = await q<Record<string, any>>("SELECT category, status, COUNT(*) AS n FROM gn_message_templates WHERE tenant_id = ? GROUP BY category, status", [T(req)]);
  res.json({ rows, summary });
}));

gnRouter.post("/gn/inbox/templates", requirePerm("gn.inbox.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ name: z.string().min(2), category: z.string().optional(), purpose: z.string().optional(), body: z.string().min(1), variables: z.array(z.string()).optional(), status: z.string().optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO gn_message_templates (tenant_id, name, category, purpose, body, variables, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [T(req), b.name, b.category ?? "whatsapp", b.purpose ?? "promotional", b.body, JSON.stringify(b.variables ?? []), b.status ?? "approved", req.user!.id]
  )).lastId;
  res.json(await q1("SELECT * FROM gn_message_templates WHERE id = ?", [id]));
}));

gnRouter.patch("/gn/inbox/templates/:id", requirePerm("gn.inbox.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ name: z.string().optional(), category: z.string().optional(), purpose: z.string().optional(), body: z.string().optional(), status: z.string().optional() }).parse(req.body);
  const before = await q1("SELECT * FROM gn_message_templates WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!before) { res.status(404).json({ error: "Template not found" }); return; }
  const sets = Object.keys(b).map((k) => `${k} = ?`);
  await run(`UPDATE gn_message_templates SET ${sets.join(", ")} WHERE id = ?`, [...Object.values(b), before.id]);
  res.json(await q1("SELECT * FROM gn_message_templates WHERE id = ?", [before.id]));
}));

/* ================= INBOX — WHATSAPP DRIPS ================= */

gnRouter.get("/gn/inbox/drips", requirePerm("gn.inbox.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT d.*, mt.name AS template_name, mt.category AS template_category FROM gn_whatsapp_drips d
     LEFT JOIN gn_message_templates mt ON mt.id = d.template_id
     WHERE d.tenant_id = ? ORDER BY d.id DESC`, [T(req)]);
  const summary = await q<Record<string, any>>("SELECT status, COUNT(*) AS n FROM gn_whatsapp_drips WHERE tenant_id = ? GROUP BY status", [T(req)]);
  res.json({ rows, summary });
}));

gnRouter.post("/gn/inbox/drips", requirePerm("gn.inbox.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ name: z.string().min(2), trigger: z.string().optional(), audience: z.string().optional(), template_id: z.number().nullable().optional(), schedule: z.string().optional(), custom_hour: z.number().nullable().optional(), status: z.string().optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO gn_whatsapp_drips (tenant_id, name, trigger, audience, template_id, schedule, custom_hour, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [T(req), b.name, b.trigger ?? "lead_captured", b.audience ?? "all_leads", b.template_id ?? null, b.schedule ?? "immediate", b.custom_hour ?? null, b.status ?? "active"]
  )).lastId;
  res.json(await q1("SELECT * FROM gn_whatsapp_drips WHERE id = ?", [id]));
}));

gnRouter.patch("/gn/inbox/drips/:id", requirePerm("gn.inbox.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ name: z.string().optional(), trigger: z.string().optional(), audience: z.string().optional(), template_id: z.number().nullable().optional(), schedule: z.string().optional(), custom_hour: z.number().nullable().optional(), status: z.string().optional() }).parse(req.body);
  const before = await q1("SELECT * FROM gn_whatsapp_drips WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!before) { res.status(404).json({ error: "Drip not found" }); return; }
  const sets = Object.keys(b).map((k) => `${k} = ?`);
  await run(`UPDATE gn_whatsapp_drips SET ${sets.join(", ")} WHERE id = ?`, [...Object.values(b), before.id]);
  res.json(await q1("SELECT * FROM gn_whatsapp_drips WHERE id = ?", [before.id]));
}));

/** Send a drip — demo execution: resolves its audience to real leads and enqueues outbound messages. */
gnRouter.post("/gn/inbox/drips/:id/send", requirePerm("gn.inbox.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const d = await q1<Record<string, any>>("SELECT * FROM gn_whatsapp_drips WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!d) { res.status(404).json({ error: "Drip not found" }); return; }
  const tpl = d.template_id ? await q1<{ name: string; body: string }>("SELECT name, body FROM gn_message_templates WHERE id = ? AND tenant_id = ?", [d.template_id, t]) : null;
  const audience = d.audience === "disb_only"
    ? await q<Record<string, any>>("SELECT id, name, mobile FROM leads WHERE tenant_id = ? AND status = 'disbursed' LIMIT 5", [t])
    : d.audience === "overdue"
      ? await q<Record<string, any>>("SELECT id, name, mobile FROM leads WHERE tenant_id = ? AND status = 'overdue' LIMIT 5", [t])
      : await q<Record<string, any>>("SELECT id, name, mobile FROM leads WHERE tenant_id = ? AND status IN ('new','assigned','contacted','followup') LIMIT 5", [t]);
  let sent = 0;
  for (const l of audience) {
    await run(
      "INSERT INTO gn_inbox_messages (tenant_id, direction, channel, to_contact, subject, body, related_type, related_id, status, created_by) VALUES (?, 'out', 'whatsapp', ?, ?, ?, 'lead', ?, 'sent', ?)",
      [t, l.mobile, tpl?.name ?? d.name, (tpl?.body ?? `Hi ${l.name}, here's your loan update from Growth Nations.`) , l.id, req.user!.id]
    );
    sent++;
  }
  await run("UPDATE gn_whatsapp_drips SET sent_count = sent_count + ?, delivered_count = delivered_count + ? WHERE id = ?", [sent, Math.max(1, Math.round(sent * 0.9)), d.id]);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.drip.send", entityType: "gn_drip", entityId: d.id, after: { sent, template: tpl?.name ?? null }, ip: clientIp(req) });
  res.json({ ok: true, sent });
}));

/* ================= DOCUMENTATION ================= */

gnRouter.get("/gn/docs", requirePerm("gn.docs.view"), asyncH(async (req: AuthedRequest, res) => {
  const { category } = req.query as Record<string, string>;
  const where = ["d.tenant_id = ?"];
  const params: unknown[] = [T(req)];
  if (category) { where.push("d.category = ?"); params.push(category); }
  const rows = await q<Record<string, any>>(
    `SELECT d.*, u.name AS updated_name FROM gn_docs d LEFT JOIN users u ON u.id = d.updated_by
     WHERE ${where.join(" AND ")} ORDER BY d.updated_at DESC`, params);
  const categories = await q<Record<string, any>>("SELECT category, COUNT(*) AS n FROM gn_docs WHERE tenant_id = ? GROUP BY category ORDER BY n DESC", [T(req)]);
  res.json({ rows, categories });
}));

gnRouter.post("/gn/docs", requirePerm("gn.docs.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ title: z.string().min(2), slug: z.string().optional(), category: z.string().optional(), content: z.string().optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO gn_docs (tenant_id, title, slug, category, content, updated_by) VALUES (?, ?, ?, ?, ?, ?)",
    [T(req), b.title, b.slug ?? null, b.category ?? "Getting Started", b.content ?? "", req.user!.id]
  )).lastId;
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.doc.create", entityType: "gn_doc", entityId: id, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_docs WHERE id = ?", [id]));
}));

gnRouter.patch("/gn/docs/:id", requirePerm("gn.docs.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ title: z.string().optional(), slug: z.string().nullable().optional(), category: z.string().optional(), content: z.string().optional() }).parse(req.body);
  const before = await q1("SELECT * FROM gn_docs WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!before) { res.status(404).json({ error: "Article not found" }); return; }
  const sets = Object.keys(b).map((k) => `${k} = ?`);
  await run(`UPDATE gn_docs SET ${sets.join(", ")}, updated_by = ?, updated_at = datetime('now') WHERE id = ?`, [...Object.values(b), req.user!.id, before.id]);
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.doc.update", entityType: "gn_doc", entityId: before.id, before, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_docs WHERE id = ?", [before.id]));
}));

/* ================= HELP & FAQ ================= */

gnRouter.get("/gn/faqs", requirePerm("gn.help.view"), asyncH(async (req: AuthedRequest, res) => {
  const { category } = req.query as Record<string, string>;
  const where = ["f.tenant_id = ?"];
  const params: unknown[] = [T(req)];
  if (category) { where.push("f.category = ?"); params.push(category); }
  const rows = await q<Record<string, any>>(`SELECT * FROM gn_faqs f WHERE ${where.join(" AND ")} ORDER BY f.id`, params);
  const categories = await q<Record<string, any>>("SELECT category, COUNT(*) AS n FROM gn_faqs WHERE tenant_id = ? GROUP BY category ORDER BY n DESC", [T(req)]);
  res.json({ rows, categories });
}));

gnRouter.post("/gn/faqs", requirePerm("gn.help.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ question: z.string().min(2), answer: z.string().min(2), category: z.string().optional() }).parse(req.body);
  const id = (await run("INSERT INTO gn_faqs (tenant_id, question, answer, category) VALUES (?, ?, ?, ?)",
    [T(req), b.question, b.answer, b.category ?? "General"])).lastId;
  res.json(await q1("SELECT * FROM gn_faqs WHERE id = ?", [id]));
}));

gnRouter.patch("/gn/faqs/:id", requirePerm("gn.help.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ helpful_yes: z.boolean().optional(), helpful_no: z.boolean().optional() }).parse(req.body);
  const before = await q1("SELECT * FROM gn_faqs WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!before) { res.status(404).json({ error: "FAQ not found" }); return; }
  if (b.helpful_yes) await run("UPDATE gn_faqs SET helpful_yes = helpful_yes + 1 WHERE id = ?", [before.id]);
  if (b.helpful_no) await run("UPDATE gn_faqs SET helpful_no = helpful_no + 1 WHERE id = ?", [before.id]);
  res.json(await q1("SELECT * FROM gn_faqs WHERE id = ?", [before.id]));
}));

gnRouter.get("/gn/support/tickets", requirePerm("gn.help.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT st.*, u.name AS created_name, a.name AS assigned_name FROM gn_support_tickets st
     LEFT JOIN users u ON u.id = st.created_by LEFT JOIN users a ON a.id = st.assigned_to
     WHERE st.tenant_id = ? ORDER BY st.id DESC`, [T(req)]);
  const summary = await q<Record<string, any>>("SELECT status, priority, COUNT(*) AS n FROM gn_support_tickets WHERE tenant_id = ? GROUP BY status, priority", [T(req)]);
  res.json({ rows, summary });
}));

gnRouter.post("/gn/support/tickets", requirePerm("gn.help.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ subject: z.string().min(2), message: z.string().min(2), priority: z.string().optional(), category: z.string().optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO gn_support_tickets (tenant_id, subject, message, priority, category, status, created_by) VALUES (?, ?, ?, ?, ?, 'open', ?)",
    [T(req), b.subject, b.message, b.priority ?? "medium", b.category ?? "Bug", req.user!.id]
  )).lastId;
  res.json(await q1("SELECT * FROM gn_support_tickets WHERE id = ?", [id]));
}));

gnRouter.patch("/gn/support/tickets/:id", requirePerm("gn.help.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ status: z.string().optional(), priority: z.string().optional(), assigned_to: z.number().nullable().optional(), resolution: z.string().nullable().optional() }).parse(req.body);
  const before = await q1("SELECT * FROM gn_support_tickets WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!before) { res.status(404).json({ error: "Ticket not found" }); return; }
  const sets = Object.keys(b).map((k) => `${k} = ?`);
  await run(`UPDATE gn_support_tickets SET ${sets.join(", ")}, resolved_at = CASE WHEN ? = 'resolved' OR ? = 'closed' THEN datetime('now') ELSE resolved_at END WHERE id = ?`, [...Object.values(b), b.status ?? null, b.status ?? null, before.id]);
  res.json(await q1("SELECT * FROM gn_support_tickets WHERE id = ?", [before.id]));
}));

/* ================= CHANGE LOG ================= */

gnRouter.get("/gn/changelog", requirePerm("gn.changelog.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>("SELECT * FROM gn_changelog WHERE tenant_id = ? ORDER BY released_at DESC, id DESC", [T(req)]);
  const summary = await q<Record<string, any>>("SELECT category, COUNT(*) AS n FROM gn_changelog WHERE tenant_id = ? GROUP BY category", [T(req)]);
  res.json({ rows, summary });
}));

gnRouter.post("/gn/changelog", requirePerm("gn.changelog.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ version: z.string().min(1), title: z.string().min(2), content: z.string().optional(), category: z.string().optional(), released_at: z.string().nullable().optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO gn_changelog (tenant_id, version, title, content, category, released_at) VALUES (?, ?, ?, ?, ?, ?)",
    [T(req), b.version, b.title, b.content ?? "", b.category ?? "feature", b.released_at ?? new Date().toISOString().slice(0, 10)]
  )).lastId;
  res.json(await q1("SELECT * FROM gn_changelog WHERE id = ?", [id]));
}));

/* ================= RECYCLE BIN (soft-delete + restore for GN entities) ================= */

function safeJson(v: string, dflt: any): any {
  try { const p = JSON.parse(v); return p ?? dflt; } catch { return dflt; }
}

const TRASH_TABLES: Record<string, string> = {
  campaign: "gn_campaigns", task: "gn_tasks", document: "gn_documents", scheme: "gn_schemes",
  doc: "gn_docs", template: "gn_message_templates", workflow: "gn_workflows", ivr_menu: "gn_ivr_menus",
  drip: "gn_whatsapp_drips", faq: "gn_faqs", changelog: "gn_changelog", message: "gn_inbox_messages"
};
const TRASH_NAMES: Record<string, string> = {
  campaign: "name", task: "title", document: "name", scheme: "name", doc: "title", template: "name",
  workflow: "name", ivr_menu: "name", drip: "name", faq: "question", changelog: "title", message: "subject"
};

async function trashEntity(t: number, uid: number, ip: string, entityType: string, entityId: number) {
  const table = TRASH_TABLES[entityType];
  if (!table) return false;
  const row = await q1<Record<string, any>>(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ?`, [entityId, t]);
  if (!row) return false;
  await run(`DELETE FROM ${table} WHERE id = ?`, [entityId]);
  await run(
    "INSERT INTO gn_trash (tenant_id, entity_type, entity_id, name, payload, deleted_by) VALUES (?, ?, ?, ?, ?, ?)",
    [t, entityType, entityId, row[TRASH_NAMES[entityType]] ?? String(entityId), JSON.stringify({ table, row }), uid]
  );
  await audit({ tenantId: t, userId: uid, action: "gn.trash.add", entityType, entityId, before: row, ip });
  return true;
}

gnRouter.get("/gn/trash", requirePerm("gn.trash.view"), asyncH(async (req: AuthedRequest, res) => {
  const { entity_type, q: search } = req.query as Record<string, string>;
  const where = ["tr.tenant_id = ?", "tr.restored_at IS NULL"];
  const params: unknown[] = [T(req)];
  if (entity_type) { where.push("tr.entity_type = ?"); params.push(entity_type); }
  if (search) { where.push("(tr.name LIKE ? OR tr.entity_type LIKE ?)"); const like = `%${search}%`; params.push(like, like); }
  const rows = await q<Record<string, any>>(
    `SELECT tr.*, u.name AS deleted_name FROM gn_trash tr LEFT JOIN users u ON u.id = tr.deleted_by
     WHERE ${where.join(" AND ")} ORDER BY tr.deleted_at DESC`, params);
  const summary = await q<Record<string, any>>("SELECT entity_type, COUNT(*) AS n FROM gn_trash WHERE tenant_id = ? GROUP BY entity_type", [T(req)]);
  res.json({ rows, summary });
}));

gnRouter.post("/gn/trash/:id/restore", requirePerm("gn.trash.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const item = await q1<Record<string, any>>("SELECT * FROM gn_trash WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!item) { res.status(404).json({ error: "Trash item not found" }); return; }
  const payload = safeJson(item.payload, null);
  if (!payload?.table || !TRASH_TABLES[item.entity_type] || payload.table !== TRASH_TABLES[item.entity_type]) {
    res.status(400).json({ error: "Corrupt trash payload" }); return;
  }
  const row: Record<string, any> = payload.row ?? {};
  const cols = Object.keys(row).filter((k) => /^[a-z_]+$/.test(k) && k !== "id");
  let restoredId = row.id;
  try {
    await run(`INSERT INTO ${payload.table} (id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`, [row.id, ...cols.map((c) => row[c])]);
  } catch {
    restoredId = (await run(`INSERT INTO ${payload.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((c) => row[c]))).lastId;
  }
  await run("DELETE FROM gn_trash WHERE id = ?", [item.id]);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.trash.restore", entityType: item.entity_type, entityId: item.entity_id, before: { trashId: item.id }, after: { restoredId }, ip: clientIp(req) });
  res.json({ ok: true, restoredId, entityType: item.entity_type });
}));

gnRouter.delete("/gn/trash/:id", requirePerm("gn.trash.manage"), asyncH(async (req: AuthedRequest, res) => {
  const item = await q1<Record<string, any>>("SELECT * FROM gn_trash WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!item) { res.status(404).json({ error: "Trash item not found" }); return; }
  await run("DELETE FROM gn_trash WHERE id = ?", [item.id]);
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.trash.purge", entityType: item.entity_type, entityId: item.entity_id, before: { trashId: item.id, name: item.name }, ip: clientIp(req) });
  res.json({ ok: true });
}));

gnRouter.delete("/gn/trash", requirePerm("gn.trash.manage"), asyncH(async (req: AuthedRequest, res) => {
  const { entity_type } = req.query as Record<string, string>;
  const t = T(req);
  let n = 0;
  if (entity_type) {
    const rows = await q<{ id: number }>("SELECT id FROM gn_trash WHERE tenant_id = ? AND entity_type = ?", [t, entity_type]);
    for (const r of rows) await run("DELETE FROM gn_trash WHERE id = ?", [r.id]);
    n = rows.length;
  } else {
    n = (await run("DELETE FROM gn_trash WHERE tenant_id = ?", [t])).changes;
  }
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.trash.empty", entityType: "gn_trash", entityId: 0, after: { purged: n }, ip: clientIp(req) });
  res.json({ ok: true, purged: n });
}));

/* ================= DELETE-TO-TRASH for existing GN entities ================= */

gnRouter.delete("/gn/campaigns/:id", requirePerm("gn.marketing.manage"), asyncH(async (req: AuthedRequest, res) => {
  const ok = await trashEntity(T(req), req.user!.id, clientIp(req), "campaign", Number(req.params.id));
  if (!ok) { res.status(404).json({ error: "Campaign not found" }); return; }
  res.json({ ok: true });
}));

gnRouter.delete("/gn/tasks/:id", requirePerm("gn.tasks.manage"), asyncH(async (req: AuthedRequest, res) => {
  const ok = await trashEntity(T(req), req.user!.id, clientIp(req), "task", Number(req.params.id));
  if (!ok) { res.status(404).json({ error: "Task not found" }); return; }
  res.json({ ok: true });
}));

gnRouter.delete("/gn/documents/:id", requirePerm("gn.documents.manage"), asyncH(async (req: AuthedRequest, res) => {
  const ok = await trashEntity(T(req), req.user!.id, clientIp(req), "document", Number(req.params.id));
  if (!ok) { res.status(404).json({ error: "Document not found" }); return; }
  res.json({ ok: true });
}));

gnRouter.delete("/gn/schemes/:id", requirePerm("gn.masters.manage"), asyncH(async (req: AuthedRequest, res) => {
  const ok = await trashEntity(T(req), req.user!.id, clientIp(req), "scheme", Number(req.params.id));
  if (!ok) { res.status(404).json({ error: "Scheme not found" }); return; }
  res.json({ ok: true });
}));

gnRouter.delete("/gn/docs/:id", requirePerm("gn.docs.manage"), asyncH(async (req: AuthedRequest, res) => {
  const ok = await trashEntity(T(req), req.user!.id, clientIp(req), "doc", Number(req.params.id));
  if (!ok) { res.status(404).json({ error: "Article not found" }); return; }
  res.json({ ok: true });
}));

gnRouter.delete("/gn/inbox/templates/:id", requirePerm("gn.inbox.manage"), asyncH(async (req: AuthedRequest, res) => {
  const ok = await trashEntity(T(req), req.user!.id, clientIp(req), "template", Number(req.params.id));
  if (!ok) { res.status(404).json({ error: "Template not found" }); return; }
  res.json({ ok: true });
}));

gnRouter.delete("/gn/inbox/drips/:id", requirePerm("gn.inbox.manage"), asyncH(async (req: AuthedRequest, res) => {
  const ok = await trashEntity(T(req), req.user!.id, clientIp(req), "drip", Number(req.params.id));
  if (!ok) { res.status(404).json({ error: "Drip not found" }); return; }
  res.json({ ok: true });
}));

gnRouter.delete("/gn/workflows/:id", requirePerm("gn.marketing.manage"), asyncH(async (req: AuthedRequest, res) => {
  const ok = await trashEntity(T(req), req.user!.id, clientIp(req), "workflow", Number(req.params.id));
  if (!ok) { res.status(404).json({ error: "Workflow not found" }); return; }
  res.json({ ok: true });
}));

gnRouter.delete("/gn/ivr/menus/:id", requirePerm("gn.marketing.manage"), asyncH(async (req: AuthedRequest, res) => {
  const ok = await trashEntity(T(req), req.user!.id, clientIp(req), "ivr_menu", Number(req.params.id));
  if (!ok) { res.status(404).json({ error: "IVR menu not found" }); return; }
  res.json({ ok: true });
}));

gnRouter.delete("/gn/faqs/:id", requirePerm("gn.help.manage"), asyncH(async (req: AuthedRequest, res) => {
  const ok = await trashEntity(T(req), req.user!.id, clientIp(req), "faq", Number(req.params.id));
  if (!ok) { res.status(404).json({ error: "FAQ not found" }); return; }
  res.json({ ok: true });
}));

gnRouter.delete("/gn/changelog/:id", requirePerm("gn.changelog.manage"), asyncH(async (req: AuthedRequest, res) => {
  const ok = await trashEntity(T(req), req.user!.id, clientIp(req), "changelog", Number(req.params.id));
  if (!ok) { res.status(404).json({ error: "Changelog entry not found" }); return; }
  res.json({ ok: true });
}));

gnRouter.delete("/gn/inbox/:id", requirePerm("gn.inbox.manage"), asyncH(async (req: AuthedRequest, res) => {
  const ok = await trashEntity(T(req), req.user!.id, clientIp(req), "message", Number(req.params.id));
  if (!ok) { res.status(404).json({ error: "Message not found" }); return; }
  res.json({ ok: true });
}));
