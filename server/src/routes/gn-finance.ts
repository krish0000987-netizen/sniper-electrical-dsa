import { Router } from "express";
import { z } from "zod";
import { q, q1, run } from "../db/connection.js";
import { audit } from "../core/audit.js";
import { asyncH, authRequired, clientIp, requirePerm, type AuthedRequest } from "../middleware.js";
import { batchRef, gnTimeline, gnSettings } from "../core/gn.js";

export const gnFinanceRouter = Router();
gnFinanceRouter.use(authRequired);

const T = (req: AuthedRequest) => req.user!.tenant_id;

/* ---------- Income / commissions ledger ---------- */

gnFinanceRouter.get("/gn/finance/income", requirePerm("gn.finance.view"), asyncH(async (req: AuthedRequest, res) => {
  const { status, lender_id, q: query } = req.query as Record<string, string>;
  const where = ["c.tenant_id = ?"];
  const params: unknown[] = [T(req)];
  if (status) { where.push("c.status = ?"); params.push(status); }
  if (lender_id) { where.push("c.lender_id = ?"); params.push(Number(lender_id)); }
  if (query) { where.push("(a.ref LIKE ? OR a.name LIKE ?)"); params.push(`%${query}%`, `%${query}%`); }
  const rows = await q<Record<string, any>>(
    `SELECT c.*, a.ref, a.name AS borrower, a.disbursed_at, l.name AS lender_name, s.name AS scheme_name
     FROM gn_commissions c
     JOIN gn_applications a ON a.id = c.app_id
     JOIN gn_lenders l ON l.id = c.lender_id
     LEFT JOIN gn_schemes s ON s.id = c.scheme_id
     WHERE ${where.join(" AND ")} ORDER BY c.id DESC LIMIT 300`, params);
  const totals = await q1<Record<string, any>>(
    `SELECT COALESCE(SUM(gross), 0) AS gross, COALESCE(SUM(gst), 0) AS gst, COALESCE(SUM(tds), 0) AS tds,
       COALESCE(SUM(net), 0) AS net, COALESCE(SUM(CASE WHEN status = 'received' THEN gross ELSE 0 END), 0) AS received
     FROM gn_commissions c WHERE ${where.join(" AND ")}`, params)!;
  res.json({ rows, totals });
}));

gnFinanceRouter.post("/gn/finance/income/:id/receive", requirePerm("gn.finance.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ utr: z.string().min(4), received_at: z.string().optional() }).parse(req.body);
  const c = await q1<Record<string, any>>("SELECT * FROM gn_commissions WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!c) { res.status(404).json({ error: "Commission not found" }); return; }
  if (c.status === "received") { res.status(400).json({ error: "Already received" }); return; }
  await run("UPDATE gn_commissions SET status = 'received', received_at = COALESCE(?, datetime('now')), utr = ? WHERE id = ?", [b.received_at ?? null, b.utr, c.id]);
  await run("UPDATE gn_applications SET status = 'payout_received', stage = 'completed', updated_at = datetime('now') WHERE id = ?", [c.app_id]);
  await gnTimeline(T(req), c.app_id, "PAYOUT RECEIVED", `Commission received · UTR ${b.utr}`, req.user!.id);
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.commission.receive", entityType: "gn_commission", entityId: c.id, before: { status: c.status }, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_commissions WHERE id = ?", [c.id]));
}));

/* ---------- Receivable aging ---------- */

gnFinanceRouter.get("/gn/finance/receivable", requirePerm("gn.finance.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT c.*, a.ref, a.name AS borrower, a.disbursed_at, l.name AS lender_name,
       CAST((julianday('now') - julianday(c.created_at)) AS INTEGER) AS age_days
     FROM gn_commissions c
     JOIN gn_applications a ON a.id = c.app_id
     JOIN gn_lenders l ON l.id = c.lender_id
     WHERE c.tenant_id = ? AND c.status = 'earned' ORDER BY c.created_at`, [T(req)]);
  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const r of rows) {
    const d = r.age_days;
    const b = d <= 30 ? "0-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : "90+";
    buckets[b as keyof typeof buckets] += r.gross;
  }
  res.json({ rows, total: rows.reduce((s, r) => s + r.gross, 0), buckets });
}));

/* ---------- Payout batches ---------- */

gnFinanceRouter.get("/gn/finance/payouts", requirePerm("gn.finance.view"), asyncH(async (req: AuthedRequest, res) => {
  const { status } = req.query as Record<string, string>;
  const where = ["tenant_id = ?"];
  const params: unknown[] = [T(req)];
  if (status) { where.push("status = ?"); params.push(status); }
  const rows = await q<Record<string, any>>(`SELECT * FROM gn_payout_batches WHERE ${where.join(" AND ")} ORDER BY id DESC`, params);
  const totals = await q1<Record<string, any>>(
    `SELECT COALESCE(SUM(CASE WHEN status IN ('draft','approved') THEN gross ELSE 0 END), 0) AS payable,
       COALESCE(SUM(CASE WHEN status = 'paid' THEN gross ELSE 0 END), 0) AS paid,
       COALESCE(SUM(CASE WHEN status = 'paid' THEN tds ELSE 0 END), 0) AS tds_paid
     FROM gn_payout_batches WHERE ${where.join(" AND ")}`, params)!;
  res.json({ rows, totals });
}));

/** Build a payout batch from earned commissions for a partner. */
gnFinanceRouter.post("/gn/finance/payouts/compute", requirePerm("gn.finance.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ payee_type: z.enum(["Partner", "Employee"]), payee_id: z.number(), payee_name: z.string(), app_ids: z.array(z.number()).min(1) }).parse(req.body);
  const settings = await gnSettings(T(req));
  const placeholders = b.app_ids.map(() => "?").join(",");
  const apps = await q<Record<string, any>>(
    `SELECT a.id, a.ref, a.commission_gross, a.commission_tds, a.commission_net, a.partner_id
     FROM gn_applications a WHERE a.id IN (${placeholders}) AND a.tenant_id = ?`, [...b.app_ids, T(req)]);
  const gross = apps.reduce((s, a) => s + a.commission_gross, 0);
  const tds = apps.reduce((s, a) => s + a.commission_tds, 0);
  const net = apps.reduce((s, a) => s + a.commission_net, 0);
  const partnerShare = Math.round((net * settings.partner_split_pct) / 100);
  const gnShare = net - partnerShare;
  res.json({
    loans: apps.map((a) => a.ref),
    gross, tds, net,
    splits: { [b.payee_name]: partnerShare, "Growth Nations": gnShare, split_pct: settings.partner_split_pct },
    computed: true
  });
}));

gnFinanceRouter.post("/gn/finance/payouts", requirePerm("gn.finance.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({
    payee_type: z.enum(["Partner", "Employee"]), payee_id: z.number(), payee_name: z.string(),
    app_ids: z.array(z.number()).min(1), mode: z.string().optional(), splits: z.record(z.number()).optional()
  }).parse(req.body);
  const settings = await gnSettings(T(req));
  const placeholders = b.app_ids.map(() => "?").join(",");
  const apps = await q<Record<string, any>>(`SELECT a.ref, a.commission_gross, a.commission_tds, a.commission_net FROM gn_applications a WHERE a.id IN (${placeholders}) AND a.tenant_id = ?`, [...b.app_ids, T(req)]);
  const gross = apps.reduce((s, a) => s + a.commission_gross, 0);
  const tds = apps.reduce((s, a) => s + a.commission_tds, 0);
  const net = apps.reduce((s, a) => s + a.commission_net, 0);
  const partnerShare = Math.round((net * settings.partner_split_pct) / 100);
  const splits = b.splits ?? { [b.payee_name]: partnerShare, "Growth Nations": net - partnerShare, split_pct: settings.partner_split_pct };
  const ref = await batchRef(T(req));
  const id = (await run(
    "INSERT INTO gn_payout_batches (tenant_id, batch_ref, payee_type, payee_id, payee_name, loans, gross, tds, net, splits, status, mode, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)",
    [T(req), ref, b.payee_type, b.payee_id, b.payee_name, JSON.stringify(apps.map((a) => a.ref)), gross, tds, net, JSON.stringify(splits), b.mode ?? null, req.user!.id]
  )).lastId;
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.payout.create", entityType: "gn_payout", entityId: id, after: { ref, ...b }, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_payout_batches WHERE id = ?", [id]));
}));

gnFinanceRouter.patch("/gn/finance/payouts/:id", requirePerm("gn.finance.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ status: z.enum(["draft", "approved", "paid"]), mode: z.string().optional(), utr: z.string().optional() }).parse(req.body);
  const before = await q1<Record<string, any>>("SELECT * FROM gn_payout_batches WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!before) { res.status(404).json({ error: "Batch not found" }); return; }
  const sets = ["status = ?"];
  const params: unknown[] = [b.status];
  if (b.mode) { sets.push("mode = ?"); params.push(b.mode); }
  if (b.utr) { sets.push("utr = ?"); params.push(b.utr); }
  if (b.status === "paid") { sets.push("paid_at = datetime('now')"); }
  params.push(before.id);
  await run(`UPDATE gn_payout_batches SET ${sets.join(", ")} WHERE id = ?`, params);
  await audit({ tenantId: T(req), userId: req.user!.id, action: `gn.payout.${b.status}`, entityType: "gn_payout", entityId: before.id, before: { status: before.status }, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_payout_batches WHERE id = ?", [before.id]));
}));

/* ---------- Customer fees ---------- */

gnFinanceRouter.get("/gn/finance/fees", requirePerm("gn.finance.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT f.*, a.ref, a.name AS customer FROM gn_customer_fees f JOIN gn_applications a ON a.id = f.app_id
     WHERE f.tenant_id = ? ORDER BY f.id DESC`, [T(req)]);
  const totals = await q1<Record<string, any>>(
    `SELECT COALESCE(SUM(processing), 0) AS processing, COALESCE(SUM(insurance), 0) AS insurance,
       COALESCE(SUM(rto), 0) AS rto, COALESCE(SUM(other), 0) AS other, COALESCE(SUM(processing + insurance + rto + other), 0) AS total
     FROM gn_customer_fees WHERE tenant_id = ?`, [T(req)])!;
  res.json({ rows, totals });
}));

gnFinanceRouter.post("/gn/finance/fees", requirePerm("gn.finance.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ app_id: z.number(), processing: z.number().optional(), insurance: z.number().optional(), rto: z.number().optional(), other: z.number().optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO gn_customer_fees (tenant_id, app_id, processing, insurance, rto, other, disbursed_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
    [T(req), b.app_id, b.processing ?? 0, b.insurance ?? 0, b.rto ?? 0, b.other ?? 0]
  )).lastId;
  await run("UPDATE gn_applications SET fees_collected = fees_collected + ? WHERE id = ?", [(b.processing ?? 0) + (b.insurance ?? 0) + (b.rto ?? 0) + (b.other ?? 0), b.app_id]);
  res.json(await q1("SELECT * FROM gn_customer_fees WHERE id = ?", [id]));
}));

/* ---------- Expenses ---------- */

gnFinanceRouter.get("/gn/finance/expenses", requirePerm("gn.finance.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>("SELECT * FROM gn_expenses WHERE tenant_id = ? ORDER BY id DESC", [T(req)]);
  const totals = await q1<Record<string, any>>("SELECT COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(CASE WHEN paid THEN amount ELSE 0 END), 0) AS paid FROM gn_expenses WHERE tenant_id = ?", [T(req)])!;
  res.json({ rows, totals });
}));

gnFinanceRouter.post("/gn/finance/expenses", requirePerm("gn.finance.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ title: z.string().min(2), category: z.string().optional(), vendor: z.string().optional(), amount: z.number().int().positive(), paid: z.boolean().optional(), claim_type: z.enum(["expense", "conveyance"]).optional() }).parse(req.body);
  const id = (await run(
    "INSERT INTO gn_expenses (tenant_id, title, category, vendor, amount, paid, claim_type, status, claimed_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
    [T(req), b.title, b.category ?? "operations", b.vendor ?? null, b.amount, b.paid ? 1 : 0, b.claim_type ?? "expense", req.user!.id]
  )).lastId;
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.finance.expense.create", entityType: "gn_expense", entityId: id, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_expenses WHERE id = ?", [id]));
}));

gnFinanceRouter.patch("/gn/finance/expenses/:id", requirePerm("gn.finance.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const b = z.object({ status: z.enum(["approved", "rejected", "paid"]), note: z.string().optional() }).parse(req.body);
  const before = await q1<{ id: number; title: string; status: string; paid: number }>("SELECT id, title, status, paid FROM gn_expenses WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!before) { res.status(404).json({ error: "Claim not found" }); return; }
  await run("UPDATE gn_expenses SET status = ?, decided_by = ?, decided_at = datetime('now'), paid = CASE WHEN ? = 'paid' THEN 1 ELSE paid END WHERE id = ?",
    [b.status, req.user!.id, b.status, before.id]);
  await audit({ tenantId: t, userId: req.user!.id, action: `gn.finance.expense.${b.status}`, entityType: "gn_expense", entityId: before.id, before: { title: before.title, status: before.status }, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_expenses WHERE id = ?", [before.id]));
}));

/* ---------- Accounting summary ---------- */

gnFinanceRouter.get("/gn/finance/accounting", requirePerm("gn.finance.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const income = await q1<{ gross: number; received: number }>(
    `SELECT COALESCE(SUM(gross), 0) AS gross, COALESCE(SUM(CASE WHEN status = 'received' THEN gross ELSE 0 END), 0) AS received
     FROM gn_commissions WHERE tenant_id = ?`, [t])!;
  const expenses = await q1<{ amount: number; paid: number }>("SELECT COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(CASE WHEN paid THEN amount ELSE 0 END), 0) AS paid FROM gn_expenses WHERE tenant_id = ?", [t])!;
  const paidOut = await q1<{ net: number }>("SELECT COALESCE(SUM(net), 0) AS net FROM gn_payout_batches WHERE tenant_id = ? AND status = 'paid'", [t])!;
  const receivable = await q1<{ gross: number }>("SELECT COALESCE(SUM(gross), 0) AS gross FROM gn_commissions WHERE tenant_id = ? AND status = 'earned'", [t])!;
  const byCategory = await q<Record<string, any>>("SELECT category, COALESCE(SUM(amount), 0) AS amount FROM gn_expenses WHERE tenant_id = ? GROUP BY category", [t]);
  res.json({
    income: income.gross, incomeReceived: income.received, receivable: receivable.gross,
    expenses: expenses.amount, expensesPaid: expenses.paid, paidOut: paidOut.net,
    netProfit: income.received - expenses.amount - paidOut.net, byCategory
  });
}));
