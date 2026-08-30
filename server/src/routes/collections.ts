import { Router } from "express";
import { z } from "zod";
import { q, q1, run } from "../db/connection.js";
import { audit } from "../core/audit.js";
import { asyncH, authRequired, clientIp, requirePerm, type AuthedRequest } from "../middleware.js";
import { recordLoanEvent } from "../core/engines.js";

export const collectionsRouter = Router();
collectionsRouter.use(authRequired);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ---------- COLLECTION QUEUE ---------- */

collectionsRouter.get("/collections/queue", requirePerm("collections.view"), asyncH(async (req: AuthedRequest, res) => {
  const { dpd, agent_id, limit = 50 } = req.query as Record<string, string>;
  const where = ["l.tenant_id = ?", "l.dpd > 0", "l.status = 'overdue'"];
  const params: unknown[] = [req.user!.tenant_id];
  if (dpd) {
    const buckets: Record<string, string> = { "1-30": "l.dpd = 1", "31-60": "l.dpd = 2", "61-90": "l.dpd = 3", "90+": "l.dpd >= 4" };
    if (buckets[dpd]) where.push(buckets[dpd]);
  }
  if (agent_id) { where.push("ct.agent_id = ?"); params.push(Number(agent_id)); }
  const rows = await q<Record<string, any>>(
    `SELECT l.id AS loan_id, l.loan_no, l.outstanding, l.dpd, l.npa_class, l.principal, l.risk_grade,
            c.id AS customer_id, c.name AS customer_name, c.mobile, c.city, c.state,
            p.name AS product_name,
            (SELECT COALESCE(SUM(i.total - i.paid_amount), 0) FROM installments i WHERE i.loan_id = l.id AND i.paid = 0 AND i.due_date <= date('now')) AS amount_due,
            (SELECT i.due_date FROM installments i WHERE i.loan_id = l.id AND i.paid = 0 ORDER BY i.seq LIMIT 1) AS next_due,
            (SELECT pt.status FROM ptps pt WHERE pt.loan_id = l.id ORDER BY pt.id DESC LIMIT 1) AS last_ptp_status,
            (SELECT COUNT(*) FROM ptps pt WHERE pt.loan_id = l.id AND pt.status = 'broken') AS broken_ptps,
            (SELECT COUNT(*) FROM payments pm WHERE pm.loan_id = l.id AND pm.status = 'received') AS payments_count,
            ct.id AS task_id, ct.priority AS task_priority, ct.status AS task_status, ct.kind AS task_kind,
            u.name AS agent_name
     FROM loans l
     JOIN customers c ON c.id = l.customer_id
     JOIN products p ON p.id = l.product_id
     LEFT JOIN collection_tasks ct ON ct.id = (SELECT MIN(ct2.id) FROM collection_tasks ct2 WHERE ct2.loan_id = l.id AND ct2.status = 'open')
     LEFT JOIN users u ON u.id = ct.agent_id
     WHERE ${where.join(" AND ")}
     ORDER BY l.dpd DESC, amount_due DESC LIMIT ${Number(limit)}`,
    params
  );
  const stats = await q1<Record<string, any>>(
    `SELECT COUNT(*) AS overdue_loans,
       COALESCE(SUM(l.outstanding), 0) AS overdue_principal,
       COALESCE(SUM(l.dpd >= 3), 0) AS npa_loans
     FROM loans l WHERE l.tenant_id = ? AND l.dpd > 0 AND l.status = 'overdue'`,
    [req.user!.tenant_id]
  );
  res.json({ rows, stats });
}));

collectionsRouter.post("/collections/queue/:loanId/task", requirePerm("collections.edit"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ kind: z.string(), priority: z.string().optional(), note: z.string().optional(), due_at: z.string().optional(), agent_id: z.number().nullable().optional() }).parse(req.body);
  const loan = await q1("SELECT * FROM loans WHERE id = ? AND tenant_id = ?", [req.params.loanId, req.user!.tenant_id]);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  const id = (await run(
    "INSERT INTO collection_tasks (tenant_id, loan_id, customer_id, agent_id, priority, kind, status, note, due_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)",
    [req.user!.tenant_id, loan.id, loan.customer_id, body.agent_id ?? null, body.priority ?? "medium", body.kind, body.note ?? null, body.due_at ?? null]
  )).lastId;
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "collections.task_create", entityType: "collection_task", entityId: id, after: body, ip: clientIp(req) });
  res.json({ id });
}));

collectionsRouter.patch("/collections/tasks/:id", requirePerm("collections.edit"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ status: z.enum(["open", "done", "skipped"]), note: z.string().optional() }).parse(req.body);
  const task = await q1("SELECT * FROM collection_tasks WHERE id = ?", [req.params.id]);
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  await run("UPDATE collection_tasks SET status = ? WHERE id = ?", [body.status, task.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: `collections.task_${body.status}`, entityType: "collection_task", entityId: task.id, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM collection_tasks WHERE id = ?", [task.id]));
}));

/* ---------- COLLECTION DASHBOARD ---------- */

collectionsRouter.get("/collections/dashboard", requirePerm("collections.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = req.user!.tenant_id;
  const totalDue = await q1<Record<string, any>>(
    `SELECT COALESCE(SUM(i.total - i.paid_amount), 0) AS due FROM installments i JOIN loans l ON l.id = i.loan_id
     WHERE l.tenant_id = ? AND i.paid = 0 AND i.due_date <= date('now')`, [t]);
  const collected = await q1<Record<string, any>>(
    `SELECT COALESCE(SUM(pa.amount), 0) AS collected FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
     WHERE p.tenant_id = ? AND p.reversed = 0 AND date(p.received_at) >= date('now', '-30 days')`, [t]);
  const overdue = await q1<Record<string, any>>(`SELECT COALESCE(SUM(outstanding), 0) AS v, COUNT(*) AS n FROM loans WHERE tenant_id = ? AND status = 'overdue'`, [t]);
  const npa = await q1<Record<string, any>>(`SELECT COALESCE(SUM(outstanding), 0) AS v, COUNT(*) AS n FROM loans WHERE tenant_id = ? AND npa_class IS NOT NULL`, [t]);
  const portfolio = await q1<Record<string, any>>(`SELECT COALESCE(SUM(outstanding), 0) AS v FROM loans WHERE tenant_id = ? AND status NOT IN ('closed','written_off')`, [t]);
  const ptpStats = await q1<Record<string, any>>(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN p.status = 'kept' THEN 1 ELSE 0 END) AS kept, SUM(CASE WHEN p.status = 'broken' THEN 1 ELSE 0 END) AS broken
     FROM ptps p JOIN loans l ON l.id = p.loan_id WHERE l.tenant_id = ? AND p.created_at >= datetime('now', '-30 days')`, [t]);
  const bucketDist = await q<Record<string, any>>(
    `SELECT CASE WHEN l.dpd = 0 THEN '0' WHEN l.dpd = 1 THEN '1-30' WHEN l.dpd = 2 THEN '31-60' WHEN l.dpd = 3 THEN '61-90' ELSE '90+' END AS bucket,
       COUNT(*) AS loans, COALESCE(SUM(l.outstanding), 0) AS outstanding
     FROM loans l WHERE l.tenant_id = ? AND l.status NOT IN ('closed','written_off') GROUP BY bucket ORDER BY l.dpd`,
    [t]);
  const agentPerformance = await q<Record<string, any>>(
    `SELECT u.name, COUNT(DISTINCT ct.id) AS tasks, SUM(CASE WHEN ct.status = 'done' THEN 1 ELSE 0 END) AS done,
            COUNT(DISTINCT p.id) AS payments, COALESCE(SUM(CASE WHEN p.reversed = 0 THEN p.amount ELSE 0 END), 0) AS collected_amount
     FROM collection_tasks ct
     LEFT JOIN users u ON u.id = ct.agent_id
     LEFT JOIN payments p ON p.recorded_by = u.id
     WHERE ct.tenant_id = ? GROUP BY u.id, u.name ORDER BY done DESC LIMIT 10`, [t]);
  const collectionEfficiency = portfolio!.v > 0 ? Math.round((collected!.collected / portfolio!.v) * 1000) / 10 : 0;
  res.json({
    totalDue: totalDue!.due,
    collected30d: collected!.collected,
    overdue: overdue!,
    npa: npa!,
    portfolio: portfolio!.v,
    ptp: ptpStats!,
    bucketDist,
    agentPerformance,
    collectionEfficiency
  });
}));

/* ---------- RECOVERY: SETTLEMENTS & WRITE-OFFS ---------- */

collectionsRouter.post("/collections/loans/:id/settlement", requirePerm("recovery.*"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ requested_amount: z.number().int().positive() }).parse(req.body);
  const loan = await q1<Record<string, any>>("SELECT * FROM loans WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  const id = (await run("INSERT INTO settlements (loan_id, requested_amount, status) VALUES (?, ?, 'requested')", [loan.id, body.requested_amount])).lastId;
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "settlement.request", entityType: "settlement", entityId: id, after: body, ip: clientIp(req) });
  res.json({ id });
}));

collectionsRouter.post("/collections/settlements/:id/approve", requirePerm("recovery.approve"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ offered_amount: z.number().int().positive() }).parse(req.body);
  const s = await q1<Record<string, any>>("SELECT * FROM settlements WHERE id = ?", [req.params.id]);
  if (!s) { res.status(404).json({ error: "Settlement not found" }); return; }
  const loan = await q1<Record<string, any>>("SELECT * FROM loans WHERE id = ?", [s.loan_id]);
  await run("INSERT INTO approvals (tenant_id, entity_type, entity_id, action, status, by_user) VALUES (?, 'settlement', ?, 'settle', 'approved', ?)", [loan!.tenant_id, s.id, req.user!.id]);
  await run("UPDATE settlements SET offered_amount = ?, status = 'approved', approved_by = ? WHERE id = ?", [body.offered_amount, req.user!.id, s.id]);
  await audit({ tenantId: loan!.tenant_id, userId: req.user!.id, action: "settlement.approve", entityType: "settlement", entityId: s.id, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM settlements WHERE id = ?", [s.id]));
}));

collectionsRouter.post("/collections/settlements/:id/close", requirePerm("recovery.approve"), asyncH(async (req: AuthedRequest, res) => {
  const s = await q1<Record<string, any>>("SELECT * FROM settlements WHERE id = ?", [req.params.id]);
  if (!s) { res.status(404).json({ error: "Settlement not found" }); return; }
  const loan = await q1<Record<string, any>>("SELECT * FROM loans WHERE id = ?", [s.loan_id]);
  const amt = s.offered_amount ?? s.requested_amount;
  const receiptNo = "RCT" + new Date().getFullYear().toString().slice(2) + String(Math.floor(100000 + Math.random() * 899999));
  await run("INSERT INTO payments (tenant_id, loan_id, customer_id, receipt_no, amount, mode, reference, status, received_at, recorded_by) VALUES (?, ?, ?, ?, ?, 'neft', 'settlement', 'received', datetime('now'), ?)",
    [loan!.tenant_id, loan!.id, loan!.customer_id, receiptNo, amt, req.user!.id]);
  await run("UPDATE settlements SET status = 'closed' WHERE id = ?", [s.id]);
  await run("UPDATE loans SET status = 'closed', closed_at = datetime('now'), outstanding = 0 WHERE id = ?", [loan!.id]);
  await recordLoanEvent(loan!.id, "settlement", { tenantId: loan!.tenant_id, amount: amt, reference: receiptNo, data: { settlement_id: s.id }, userId: req.user!.id });
  await run("INSERT INTO notifications (tenant_id, title, body) VALUES (?, 'Settlement closed', ?)", [loan!.tenant_id, `${loan!.loan_no} settled at ${inrShort(amt)}`]);
  await audit({ tenantId: loan!.tenant_id, userId: req.user!.id, action: "settlement.close", entityType: "settlement", entityId: s.id, after: { amt }, ip: clientIp(req) });
  res.json({ ok: true });
}));

collectionsRouter.post("/collections/loans/:id/writeoff", requirePerm("recovery.*"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ amount: z.number().int().positive(), reason: z.string() }).parse(req.body);
  const loan = await q1<Record<string, any>>("SELECT * FROM loans WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  const id = (await run("INSERT INTO writeoffs (loan_id, amount, reason, status) VALUES (?, ?, ?, 'requested')", [loan.id, body.amount, body.reason])).lastId;
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "writeoff.request", entityType: "writeoff", entityId: id, after: body, ip: clientIp(req) });
  res.json({ id });
}));

collectionsRouter.post("/collections/writeoffs/:id/approve", requirePerm("recovery.approve"), asyncH(async (req: AuthedRequest, res) => {
  const w = await q1<Record<string, any>>("SELECT * FROM writeoffs WHERE id = ?", [req.params.id]);
  if (!w) { res.status(404).json({ error: "Write-off not found" }); return; }
  const loan = await q1<Record<string, any>>("SELECT * FROM loans WHERE id = ?", [w.loan_id]);
  await run("INSERT INTO approvals (tenant_id, entity_type, entity_id, action, status, by_user) VALUES (?, 'writeoff', ?, 'writeoff', 'approved', ?)", [loan!.tenant_id, w.id, req.user!.id]);
  await run("UPDATE writeoffs SET status = 'posted', approved_by = ? WHERE id = ?", [req.user!.id, w.id]);
  await run("UPDATE loans SET written_off = 1, status = 'written_off' WHERE id = ?", [loan!.id]);
  await recordLoanEvent(loan!.id, "writeoff", { tenantId: loan!.tenant_id, amount: w.amount, reference: loan!.loan_no, data: { writeoff_id: w.id, reason: w.reason }, userId: req.user!.id });
  await run("INSERT INTO notifications (tenant_id, title, body) VALUES (?, 'Loan written off', ?)", [loan!.tenant_id, `${loan!.loan_no} written off (${inrShort(w.amount)})`]);
  await audit({ tenantId: loan!.tenant_id, userId: req.user!.id, action: "writeoff.approve", entityType: "writeoff", entityId: w.id, after: { amount: w.amount }, ip: clientIp(req) });
  res.json({ ok: true });
}));

function inrShort(n: number): string {
  return "₹" + n.toLocaleString("en-IN");
}
