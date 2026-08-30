import { Router } from "express";
import { z } from "zod";
import { q, q1, run, now } from "../db/connection.js";
import { audit } from "../core/audit.js";
import { asyncH, authRequired, clientIp, requirePerm, type AuthedRequest } from "../middleware.js";

export const crmRouter = Router();
crmRouter.use(authRequired);

const LEAD_STATUSES = ["new", "assigned", "contacted", "interested", "not_interested", "followup", "converted", "dnd", "wrong_number", "lost"];
const SOURCES = ["website", "meta", "google", "whatsapp", "call", "referral", "dsa", "field", "branch", "api", "walkin", "partner", "aggregator"];

function leadScore(lead: Record<string, any>): number {
  let s = 0;
  const amount = lead.requested_amount || 0;
  const income = lead.monthly_income || 0;
  if (amount >= 500000) s += 30;
  else if (amount >= 200000) s += 20;
  else s += 10;
  if (income >= 75000) s += 25;
  else if (income >= 40000) s += 15;
  else if (income >= 20000) s += 8;
  const hotSources = ["website", "referral", "partner", "walkin"];
  if (hotSources.includes(lead.source)) s += 15;
  if (lead.status === "interested") s += 20;
  if (lead.status === "contacted") s += 10;
  if (lead.status === "converted") s += 25;
  return Math.min(100, s);
}

function leadProbability(status: string): number {
  const map: Record<string, number> = { new: 10, assigned: 15, contacted: 25, followup: 40, interested: 65, converted: 100, lost: 0, dnd: 0, wrong_number: 0, not_interested: 0 };
  return map[status] ?? 10;
}

/* ---------- LEADS ---------- */

crmRouter.get("/leads", requirePerm("leads.view"), asyncH(async (req: AuthedRequest, res) => {
  const { status, source, q: query, sort = "created_at", dir = "desc", page = 1, limit = 25 } = req.query as Record<string, string>;
  const where: string[] = ["l.tenant_id = ?"];
  const params: unknown[] = [req.user!.tenant_id];
  if (status) { where.push("l.status = ?"); params.push(status); }
  if (source) { where.push("l.source = ?"); params.push(source); }
  if (query) { where.push("(l.name LIKE ? OR l.mobile LIKE ? OR l.lead_no LIKE ?)"); params.push(`%${query}%`, `%${query}%`, `%${query}%`); }
  const allowSort = ["created_at", "score", "requested_amount", "followup_at"];
  const order = allowSort.includes(sort) ? sort : "created_at";
  const off = (Math.max(1, Number(page)) - 1) * Number(limit);
  const total = (await q1<{ n: number }>(`SELECT COUNT(*) AS n FROM leads l WHERE ${where.join(" AND ")}`, params))!.n;
  const rows = await q<Record<string, any>>(
    `SELECT l.*, u.name AS owner_name, c.name AS customer_name
     FROM leads l LEFT JOIN users u ON u.id = l.owner_id LEFT JOIN customers c ON c.id = l.customer_id
     WHERE ${where.join(" AND ")} ORDER BY l.${order} ${dir === "asc" ? "ASC" : "DESC"} LIMIT ? OFFSET ?`,
    [...params, Number(limit), off]
  );
  res.json({ rows, total, page: Number(page), limit: Number(limit) });
}));

crmRouter.get("/leads/stats", requirePerm("leads.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>("SELECT status, COUNT(*) AS n FROM leads WHERE tenant_id = ? GROUP BY status", [req.user!.tenant_id]);
  res.json(rows);
}));

const leadSchema = z.object({
  name: z.string().min(2),
  mobile: z.string().optional(),
  email: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  loan_type: z.string().optional(),
  requested_amount: z.number().optional(),
  monthly_income: z.number().optional(),
  business_turnover: z.number().optional(),
  source: z.string().optional(),
  campaign: z.string().optional(),
  dsa_id: z.number().nullable().optional(),
  owner_id: z.number().nullable().optional(),
  status: z.enum(LEAD_STATUSES as [string, ...string[]]).optional(),
  next_action: z.string().optional(),
  followup_at: z.string().optional(),
  notes: z.string().optional(),
  branch_id: z.number().nullable().optional()
});

function leadNo(): string {
  return "LD" + new Date().getFullYear().toString().slice(2) + String(Math.floor(1000 + Math.random() * 9000));
}

crmRouter.post("/leads", requirePerm("leads.create"), asyncH(async (req: AuthedRequest, res) => {
  const body = leadSchema.parse(req.body);
  const tenantId = req.user!.tenant_id;
  const id = (await run(
    `INSERT INTO leads (tenant_id, branch_id, lead_no, name, mobile, email, city, state, loan_type, requested_amount,
       monthly_income, business_turnover, source, campaign, dsa_id, owner_id, status, next_action, followup_at, notes, score, probability)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    [tenantId, body.branch_id ?? req.user!.branch_id, leadNo(), body.name, body.mobile ?? null, body.email ?? null,
     body.city ?? null, body.state ?? null, body.loan_type ?? "personal", body.requested_amount ?? null,
     body.monthly_income ?? null, body.business_turnover ?? null, body.source ?? "walkin", body.campaign ?? null,
     body.dsa_id ?? null, body.owner_id ?? null, body.status ?? "new", body.next_action ?? null, body.followup_at ?? null, body.notes ?? null]
  )).lastId;
  const row = await q1("SELECT * FROM leads WHERE id = ?", [id])!;
  await run("UPDATE leads SET score = ?, probability = ? WHERE id = ?", [leadScore(row), leadProbability(row.status), id]);
  await audit({ tenantId, userId: req.user!.id, action: "lead.create", entityType: "lead", entityId: id, after: row, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM leads WHERE id = ?", [id]));
}));

crmRouter.get("/leads/:id", requirePerm("leads.view"), asyncH(async (req: AuthedRequest, res) => {
  const lead = await q1<Record<string, any>>(
    `SELECT l.*, u.name AS owner_name FROM leads l LEFT JOIN users u ON u.id = l.owner_id WHERE l.id = ? AND l.tenant_id = ?`,
    [req.params.id, req.user!.tenant_id]
  );
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  const activities = await q("SELECT * FROM lead_activities WHERE lead_id = ? ORDER BY id DESC LIMIT 30", [lead.id]);
  res.json({ lead, activities });
}));

crmRouter.patch("/leads/:id", requirePerm("leads.edit"), asyncH(async (req: AuthedRequest, res) => {
  const body = leadSchema.partial().parse(req.body);
  const before = await q1("SELECT * FROM leads WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!before) { res.status(404).json({ error: "Lead not found" }); return; }
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    sets.push(`${k} = ?`);
    params.push(v === undefined ? null : v);
  }
  if (body.status) {
    await run("INSERT INTO lead_activities (lead_id, user_id, kind, outcome, note) VALUES (?, ?, 'status_change', ?, ?)",
      [before.id, req.user!.id, body.status, `Status → ${body.status}`]);
  }
  params.push(req.params.id, req.user!.tenant_id);
  await run(`UPDATE leads SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`, params);
  const row = await q1("SELECT * FROM leads WHERE id = ?", [before.id])!;
  await run("UPDATE leads SET score = ?, probability = ? WHERE id = ?", [leadScore(row), leadProbability(row.status), row.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "lead.update", entityType: "lead", entityId: before.id, before, after: row, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM leads WHERE id = ?", [before.id]));
}));

crmRouter.post("/leads/:id/activity", requirePerm("leads.edit"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ kind: z.string(), outcome: z.string().optional(), note: z.string().optional(), duration_sec: z.number().optional() }).parse(req.body);
  const lead = await q1("SELECT * FROM leads WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  const id = (await run(
    "INSERT INTO lead_activities (lead_id, user_id, kind, outcome, note, duration_sec) VALUES (?, ?, ?, ?, ?, ?)",
    [lead.id, req.user!.id, body.kind, body.outcome ?? null, body.note ?? null, body.duration_sec ?? null]
  )).lastId;
  if (body.kind === "call") {
    await run("UPDATE leads SET status = 'contacted', updated_at = datetime('now') WHERE id = ?", [lead.id]);
  }
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: `lead.${body.kind}`, entityType: "lead", entityId: lead.id, after: body, ip: clientIp(req) });
  res.json({ id });
}));

/** Convert lead → customer → application. */
crmRouter.post("/leads/:id/convert", requirePerm("leads.convert"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ product_id: z.number(), requested_amount: z.number(), tenure: z.number(), purpose: z.string().optional() }).parse(req.body);
  const lead = await q1<Record<string, any>>("SELECT * FROM leads WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  if (lead.customer_id) {
    res.status(400).json({ error: "Lead already converted" });
    return;
  }
  const custNo = "CUS" + String(10000 + Math.floor(Math.random() * 89999));
  const customerId = (await run(
    `INSERT INTO customers (tenant_id, customer_no, name, mobile, email, city, state, monthly_income, business_turnover, kyc_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [req.user!.tenant_id, custNo, lead.name, lead.mobile ?? null, lead.email ?? null, lead.city ?? null, lead.state ?? null,
     lead.monthly_income ?? null, lead.business_turnover ?? null]
  )).lastId;
  const appNo = "APP" + new Date().getFullYear().toString().slice(2) + String(Math.floor(100000 + Math.random() * 899999));
  const appId = (await run(
    `INSERT INTO applications (tenant_id, application_no, lead_id, customer_id, product_id, branch_id, dsa_id, sales_officer_id, source, requested_amount, tenure, purpose, status, stage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_progress', 'kyc')`,
    [req.user!.tenant_id, appNo, lead.id, customerId, body.product_id, lead.branch_id ?? req.user!.branch_id,
     lead.dsa_id ?? null, lead.owner_id ?? null, lead.source ?? "lead", body.requested_amount, body.tenure, body.purpose ?? null]
  )).lastId;
  await run("UPDATE leads SET customer_id = ?, status = 'converted', probability = 100, updated_at = datetime('now') WHERE id = ?", [customerId, lead.id]);
  await run("INSERT INTO lead_activities (lead_id, user_id, kind, outcome, note) VALUES (?, ?, 'convert', 'converted', ?)", [lead.id, req.user!.id, `Created application ${appNo}`]);
  await run("INSERT INTO application_stages (application_id, stage, entered_at, status) VALUES (?, 'application', datetime('now'), 'completed')", [appId]);
  await run("INSERT INTO application_stages (application_id, stage, entered_at, status) VALUES (?, 'kyc', datetime('now'), 'in_progress')", [appId]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "lead.convert", entityType: "lead", entityId: lead.id, after: { customerId, appId }, ip: clientIp(req) });
  res.json({ customerId, applicationId: appId, applicationNo: appNo });
}));

/* ---------- CUSTOMERS ---------- */

crmRouter.get("/customers", requirePerm("customers.view"), asyncH(async (req: AuthedRequest, res) => {
  const { q: query, status, page = 1, limit = 25, sort = "created_at", dir = "desc" } = req.query as Record<string, string>;
  const where = ["c.tenant_id = ?"];
  const params: unknown[] = [req.user!.tenant_id];
  if (query) { where.push("(c.name LIKE ? OR c.mobile LIKE ? OR c.pan LIKE ? OR c.customer_no LIKE ?)"); params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`); }
  if (status) { where.push("c.status = ?"); params.push(status); }
  const total = (await q1<{ n: number }>(`SELECT COUNT(*) AS n FROM customers c WHERE ${where.join(" AND ")}`, params))!.n;
  const rows = await q<Record<string, any>>(
    `SELECT c.*,
       (SELECT COUNT(*) FROM loans l WHERE l.customer_id = c.id AND l.status NOT IN ('closed','written_off')) AS active_loans,
       (SELECT COUNT(*) FROM applications a WHERE a.customer_id = c.id) AS applications_count
     FROM customers c WHERE ${where.join(" AND ")}
     ORDER BY c.${["created_at", "name", "credit_score"].includes(sort) ? sort : "created_at"} ${dir === "asc" ? "ASC" : "DESC"}
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), (Math.max(1, Number(page)) - 1) * Number(limit)]
  );
  res.json({ rows, total, page: Number(page), limit: Number(limit) });
}));

const customerSchema = z.object({
  name: z.string().min(2),
  mobile: z.string().optional(),
  email: z.string().optional(),
  dob: z.string().optional(),
  gender: z.string().optional(),
  pan: z.string().optional(),
  address_line1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  employment_type: z.string().optional(),
  business_name: z.string().optional(),
  annual_income: z.number().optional(),
  monthly_income: z.number().optional(),
  business_turnover: z.number().optional()
});

crmRouter.post("/customers", requirePerm("customers.edit"), asyncH(async (req: AuthedRequest, res) => {
  const body = customerSchema.parse(req.body);
  const custNo = "CUS" + String(10000 + Math.floor(Math.random() * 89999));
  const id = (await run(
    `INSERT INTO customers (tenant_id, customer_no, name, mobile, email, dob, gender, pan, address_line1, city, state, pincode, employment_type, business_name, annual_income, monthly_income, business_turnover)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user!.tenant_id, custNo, body.name, body.mobile ?? null, body.email ?? null, body.dob ?? null, body.gender ?? null,
     body.pan ?? null, body.address_line1 ?? null, body.city ?? null, body.state ?? null, body.pincode ?? null,
     body.employment_type ?? null, body.business_name ?? null, body.annual_income ?? null, body.monthly_income ?? null, body.business_turnover ?? null]
  )).lastId;
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "customer.create", entityType: "customer", entityId: id, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM customers WHERE id = ?", [id]));
}));

crmRouter.get("/customers/:id", requirePerm("customers.view"), asyncH(async (req: AuthedRequest, res) => {
  const c = await q1<Record<string, any>>("SELECT * FROM customers WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!c) { res.status(404).json({ error: "Customer not found" }); return; }
  const loans = await q(`SELECT id, loan_no, principal, outstanding, dpd, status, risk_grade, disbursed_at FROM loans WHERE customer_id = ? ORDER BY id DESC LIMIT 10`, [c.id]);
  const applications = await q(`SELECT id, application_no, requested_amount, status, stage, created_at FROM applications WHERE customer_id = ? ORDER BY id DESC LIMIT 10`, [c.id]);
  const documents = await q(`SELECT id, category, name, status, verified_at, ocr_confidence FROM documents WHERE customer_id = ? ORDER BY id DESC LIMIT 20`, [c.id]);
  const bureau = await q1("SELECT * FROM bureau_reports WHERE customer_id = ? ORDER BY id DESC LIMIT 1", [c.id]);
  const bank = await q1("SELECT * FROM bank_analyses WHERE customer_id = ? ORDER BY id DESC LIMIT 1", [c.id]);
  const consents = await q("SELECT * FROM consents WHERE customer_id = ? ORDER BY id DESC LIMIT 10", [c.id]);
  const activities = await q(
    `SELECT la.kind, la.outcome, la.note, la.created_at, u.name AS by_name
     FROM lead_activities la LEFT JOIN users u ON u.id = la.user_id WHERE la.lead_id IN (SELECT id FROM leads WHERE customer_id = ?) ORDER BY la.id DESC LIMIT 15`,
    [c.id]
  );
  const payments = await q(`SELECT id, receipt_no, amount, mode, status, received_at FROM payments WHERE customer_id = ? ORDER BY id DESC LIMIT 10`, [c.id]);
  const exposure = await q1<{ total: number }>(
    `SELECT COALESCE(SUM(outstanding), 0) AS total FROM loans WHERE customer_id = ? AND status NOT IN ('closed', 'written_off')`, [c.id]
  );
  const communications = await q(`SELECT * FROM lead_activities la WHERE la.lead_id IN (SELECT id FROM leads WHERE customer_id = ?) AND la.kind IN ('call','whatsapp','email') ORDER BY la.id DESC LIMIT 10`, [c.id]);
  res.json({ customer: c, loans, applications, documents, bureau, bank, consents, activities, payments, exposure: exposure?.total ?? 0, communications });
}));

crmRouter.patch("/customers/:id", requirePerm("customers.edit"), asyncH(async (req: AuthedRequest, res) => {
  const body = customerSchema.partial().parse(req.body);
  const before = await q1("SELECT * FROM customers WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!before) { res.status(404).json({ error: "Customer not found" }); return; }
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    sets.push(`${k} = ?`);
    params.push(v === undefined ? null : v);
  }
  params.push(req.params.id, req.user!.tenant_id);
  await run(`UPDATE customers SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`, params);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "customer.update", entityType: "customer", entityId: before.id, before, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM customers WHERE id = ?", [before.id]));
}));

/* ---------- TELE-CALLING QUEUE ---------- */

crmRouter.get("/telecall", requirePerm("leads.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT l.*, u.name AS owner_name FROM leads l LEFT JOIN users u ON u.id = l.owner_id
     WHERE l.tenant_id = ? AND l.status IN ('new', 'assigned', 'contacted', 'followup', 'interested')
     ORDER BY CASE l.status WHEN 'interested' THEN 0 WHEN 'followup' THEN 1 WHEN 'contacted' THEN 2 WHEN 'assigned' THEN 3 ELSE 4 END,
     COALESCE(l.followup_at, '9999') ASC, l.score DESC LIMIT 100`,
    [req.user!.tenant_id]
  );
  const stats = await q<Record<string, any>>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN status IN ('contacted','followup','interested','converted') THEN 1 ELSE 0 END) AS connected,
       SUM(CASE WHEN status = 'interested' THEN 1 ELSE 0 END) AS interested,
       SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS converted
     FROM leads WHERE tenant_id = ?`,
    [req.user!.tenant_id]
  );
  res.json({ rows, stats: stats[0] });
}));

crmRouter.get("/crm/summary", requirePerm("leads.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = req.user!.tenant_id;
  const leads = await q1<Record<string, any>>("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS converted FROM leads WHERE tenant_id = ?", [t]);
  const bySource = await q("SELECT source, COUNT(*) AS n FROM leads WHERE tenant_id = ? GROUP BY source ORDER BY n DESC", [t]);
  const followups = await q("SELECT COUNT(*) AS n FROM leads WHERE tenant_id = ? AND status IN ('new','followup','interested')", [t]);
  const byStatus = await q("SELECT status, COUNT(*) AS n FROM leads WHERE tenant_id = ? GROUP BY status", [t]);
  res.json({ leads: leads![0], bySource, byStatus, followups: followups![0].n });
}));

export { now };
