import { Router } from "express";
import { z } from "zod";
import { q, q1, run } from "../db/connection.js";
import { audit } from "../core/audit.js";
import { asyncH, authRequired, clientIp, requirePerm, type AuthedRequest } from "../middleware.js";
import { allocatePayment, buildSchedule, computeDpd, computeEmi, foreclosureQuote, type AllocationComponent } from "../core/finance.js";
import { recordLoanEvent } from "../core/engines.js";

export const lmsRouter = Router();
lmsRouter.use(authRequired);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Recompute DPD, NPA class and status for a loan from its installments. */
export async function refreshLoanState(loanId: number) {
  const loan = await q1<Record<string, any>>("SELECT * FROM loans WHERE id = ?", [loanId]);
  if (!loan) return;
  const insts = await q<Record<string, any>>("SELECT * FROM installments WHERE loan_id = ? ORDER BY seq", [loanId]);
  const due = computeDpd(insts.map((i) => ({ dueDate: i.due_date, paid: i.paid, paidAmount: i.paid_amount })), today());
  const npaCfgRow = await q1<Record<string, any>>("SELECT value FROM system_config WHERE tenant_id = ? AND key = 'npa_policy'", [loan.tenant_id]);
  const npaCfg = npaCfgRow ? JSON.parse(npaCfgRow.value) : {};
  const npaDays = npaCfg.npa_days ?? 90;
  const npaClass = due.daysLate >= npaDays ? (due.daysLate >= (npaCfg.substandard_days ?? 180) ? "Substandard" : "NPA") : null;
  for (const i of insts) {
    if (i.paid === 0 && i.due_date < today()) {
      const dl = Math.round((Date.now() - new Date(i.due_date + "T00:00:00").getTime()) / 86400000);
      await run("UPDATE installments SET status = 'overdue', days_late = ? WHERE id = ?", [Math.max(0, dl), i.id]);
    }
  }
  const sum = await q1<Record<string, any>>(
    `SELECT COALESCE(SUM(CASE WHEN paid = 0 THEN principal ELSE 0 END), 0) AS unpaid_principal,
            COALESCE(SUM(CASE WHEN paid = 0 THEN interest ELSE 0 END), 0) AS unpaid_interest
     FROM installments WHERE loan_id = ?`,
    [loanId]
  )!;
  const status = loan.written_off ? "written_off" : loan.status === "closed" ? "closed" : due.missedInstallments > 0 ? "overdue" : loan.status === "restructured" ? "restructured" : "active";
  await run(
    "UPDATE loans SET dpd = ?, npa_class = ?, status = ?, outstanding = ?, updated_at = datetime('now') WHERE id = ?",
    [due.missedInstallments, npaClass, status, sum.unpaid_principal, loanId]
  );
}

/* ---------- LOANS ---------- */

lmsRouter.get("/loans", requirePerm("loans.view"), asyncH(async (req: AuthedRequest, res) => {
  const { q: query, status, page = 1, limit = 25, sort = "created_at", dir = "desc", dpd } = req.query as Record<string, string>;
  const where = ["l.tenant_id = ?"];
  const params: unknown[] = [req.user!.tenant_id];
  if (query) { where.push("(l.loan_no LIKE ? OR c.name LIKE ? OR c.mobile LIKE ?)"); params.push(`%${query}%`, `%${query}%`, `%${query}%`); }
  if (status) { where.push("l.status = ?"); params.push(status); }
  if (dpd) {
    const buckets: Record<string, string> = { "0": "l.dpd = 0", "1-30": "l.dpd = 1", "31-60": "l.dpd = 2", "61-90": "l.dpd = 3", "90+": "l.dpd >= 4" };
    if (buckets[dpd]) where.push(buckets[dpd]);
  }
  const total = (await q1<{ n: number }>(`SELECT COUNT(*) AS n FROM loans l JOIN customers c ON c.id = l.customer_id WHERE ${where.join(" AND ")}`, params))!.n;
  const rows = await q<Record<string, any>>(
    `SELECT l.id, l.loan_no, l.principal, l.outstanding, l.rate, l.tenure, l.emi, l.dpd, l.npa_class, l.status,
            l.risk_grade, l.disbursed_at, l.first_emi_at, l.fees_due, l.penal_due,
            c.name AS customer_name, c.mobile, c.city,
            p.name AS product_name,
            (SELECT COALESCE(SUM(total), 0) FROM installments i WHERE i.loan_id = l.id AND i.paid = 1) AS total_paid
     FROM loans l JOIN customers c ON c.id = l.customer_id JOIN products p ON p.id = l.product_id
     WHERE ${where.join(" AND ")}
     ORDER BY l.${["created_at", "principal", "outstanding", "dpd"].includes(sort) ? sort : "created_at"} ${dir === "asc" ? "ASC" : "DESC"}
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), (Math.max(1, Number(page)) - 1) * Number(limit)]
  );
  res.json({ rows, total, page: Number(page), limit: Number(limit) });
}));

/* ---------- PAYMENTS LEDGER ---------- */

lmsRouter.get("/payments", requirePerm("payments.view"), asyncH(async (req: AuthedRequest, res) => {
  const { q: query, status, page = 1, limit = 25, sort = "received_at", dir = "desc" } = req.query as Record<string, string>;
  const where = ["p.tenant_id = ?"];
  const params: unknown[] = [req.user!.tenant_id];
  if (query) { where.push("(p.receipt_no LIKE ? OR p.reference LIKE ? OR l.loan_no LIKE ? OR c.name LIKE ?)"); params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`); }
  if (status) { where.push("p.status = ?"); params.push(status); }
  const total = (await q1<{ n: number }>(`SELECT COUNT(*) AS n FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = p.customer_id WHERE ${where.join(" AND ")}`, params))!.n;
  const rows = await q<Record<string, any>>(
    `SELECT p.id, p.receipt_no, p.amount, p.mode, p.reference, p.status, p.reversed, p.reversal_reason, p.allocated,
            p.received_at, p.recorded_by, l.id AS loan_id, l.loan_no, l.outstanding AS loan_outstanding,
            c.id AS customer_id, c.name AS customer_name, c.mobile,
            (SELECT COALESCE(SUM(a.amount), 0) FROM payment_allocations a WHERE a.payment_id = p.id) AS allocated_amount
     FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = p.customer_id
     WHERE ${where.join(" AND ")}
     ORDER BY p.${["received_at", "amount", "id"].includes(sort) ? sort : "received_at"} ${dir === "asc" ? "ASC" : "DESC"}
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), (Math.max(1, Number(page)) - 1) * Number(limit)]
  );
  res.json({ rows, total, page: Number(page), limit: Number(limit) });
}));

lmsRouter.get("/loans/:id", requirePerm("loans.view"), asyncH(async (req: AuthedRequest, res) => {
  const loan = await q1<Record<string, any>>(
    `SELECT l.*, c.name AS customer_name, c.mobile, c.email, c.pan, c.city, c.state, c.employment_type,
            p.name AS product_name, p.category, p.allocation_order, p.interest_type, p.foreclosure_charge_pct,
            p.prepayment_allowed, p.part_payment_min_amount, p.emi_frequency, p.late_fee_amount, p.grace_days, p.penal_rate_pct,
            b.name AS branch_name, u.name AS officer_name
     FROM loans l
     JOIN customers c ON c.id = l.customer_id
     JOIN products p ON p.id = l.product_id
     LEFT JOIN branches b ON b.id = l.branch_id
     LEFT JOIN users u ON u.id = c.id
     WHERE l.id = ? AND l.tenant_id = ?`,
    [req.params.id, req.user!.tenant_id]
  );
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  await refreshLoanState(loan.id);
  const installments = await q("SELECT * FROM installments WHERE loan_id = ? ORDER BY seq", [loan.id]);
  const payments = await q("SELECT * FROM payments WHERE loan_id = ? ORDER BY received_at DESC", [loan.id]);
  const allocations = await q("SELECT * FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE loan_id = ?) ORDER BY id", [loan.id]);
  const ptps = await q("SELECT * FROM ptps WHERE loan_id = ? ORDER BY id DESC", [loan.id]);
  const charges = await q("SELECT * FROM charge_events WHERE loan_id = ? ORDER BY id DESC", [loan.id]);
  const tasks = await q("SELECT * FROM collection_tasks WHERE loan_id = ? ORDER BY id DESC", [loan.id]);
  const settlements = await q("SELECT * FROM settlements WHERE loan_id = ? ORDER BY id DESC", [loan.id]);
  const writeoffs = await q("SELECT * FROM writeoffs WHERE loan_id = ? ORDER BY id DESC", [loan.id]);
  const auditLogs = await q("SELECT * FROM audit_logs WHERE entity_type = 'loan' AND entity_id = ? ORDER BY id DESC LIMIT 30", [loan.id]);
  const totalPaid = await q1<{ s: number }>("SELECT COALESCE(SUM(paid_amount), 0) AS s FROM installments WHERE loan_id = ?", [loan.id]);
  const refreshed = await q1("SELECT * FROM loans WHERE id = ?", [loan.id]);
  res.json({ loan: { ...loan, ...refreshed }, installments, payments, allocations, ptps, charges, tasks, settlements, writeoffs, auditLogs, totalPaid: totalPaid!.s });
}));

/* ---------- PAYMENTS ---------- */

const paymentSchema = z.object({
  amount: z.number().int().positive(),
  mode: z.string(),
  reference: z.string().optional(),
  received_at: z.string().optional()
});

lmsRouter.post("/loans/:id/payment", requirePerm("payments.record"), asyncH(async (req: AuthedRequest, res) => {
  const body = paymentSchema.parse(req.body);
  const loan = await q1<Record<string, any>>("SELECT * FROM loans WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  if (loan.status === "closed" || loan.written_off) { res.status(400).json({ error: "Loan is closed/written off" }); return; }
  const product = await q1<Record<string, any>>("SELECT * FROM products WHERE id = ?", [loan.product_id])!;
  const insts = await q<Record<string, any>>("SELECT * FROM installments WHERE loan_id = ? ORDER BY seq", [loan.id]);

  // Configurable allocation order from product policy
  const order = (product.allocation_order || "penalty,fees,interest,principal").split(",") as AllocationComponent[];
  const alloc = allocatePayment({
    amount: body.amount,
    order,
    penalDue: loan.penal_due,
    feesDue: loan.fees_due,
    installments: insts.map((i) => ({ seq: i.seq, total: i.total, paidAmount: i.paid_amount, interest: i.interest, principal: i.principal })),
    allowFuturePrincipal: !!product.prepayment_allowed
  });

  const receiptNo = "RCT" + new Date().getFullYear().toString().slice(2) + String(Math.floor(100000 + Math.random() * 899999));
  const payId = (await run(
    "INSERT INTO payments (tenant_id, loan_id, customer_id, receipt_no, amount, mode, reference, status, received_at, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)",
    [req.user!.tenant_id, loan.id, loan.customer_id, receiptNo, body.amount, body.mode, body.reference ?? null, body.received_at ?? new Date().toISOString(), req.user!.id]
  )).lastId;

  // Apply allocations to installments oldest-first
  for (const a of alloc.allocations) {
    await run("INSERT INTO payment_allocations (payment_id, installment_id, component, amount) VALUES (?, ?, ?, ?)", [payId, a.seq ?? null, a.component, a.amount]);
    if (a.seq) {
      const inst = insts.find((i) => i.seq === a.seq);
      if (inst) {
        const newPaid = inst.paid_amount + a.amount;
        const fullyPaid = newPaid >= inst.total;
        await run("UPDATE installments SET paid_amount = ?, paid = ?, status = ?, paid_at = datetime('now') WHERE id = ?",
          [newPaid, fullyPaid ? 1 : 0, fullyPaid ? "paid" : "part_paid", inst.id]);
      }
    }
  }
  // Penal & fees consumption
  if (alloc.allocations.some((a) => a.component === "penalty")) {
    await run("UPDATE loans SET penal_due = MAX(0, penal_due - ?) WHERE id = ?", [alloc.allocations.filter((a) => a.component === "penalty").reduce((s, a) => s + a.amount, 0), loan.id]);
  }
  if (alloc.allocations.some((a) => a.component === "fees")) {
    await run("UPDATE loans SET fees_due = MAX(0, fees_due - ?) WHERE id = ?", [alloc.allocations.filter((a) => a.component === "fees").reduce((s, a) => s + a.amount, 0), loan.id]);
  }
  await refreshLoanState(loan.id);
  await run("UPDATE payments SET allocated = 1 WHERE id = ?", [payId]);
  await recordLoanEvent(loan.id, "payment", { tenantId: req.user!.tenant_id, amount: body.amount, reference: receiptNo, data: { mode: body.mode, allocations: alloc.allocations, unallocated: alloc.remaining }, userId: req.user!.id });
  await run("INSERT INTO notifications (tenant_id, title, body) VALUES (?, 'Payment received', ?)",
    [req.user!.tenant_id, `${inrShort(body.amount)} received on ${loan.loan_no} (${body.mode.toUpperCase()})`]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "payment.record", entityType: "payment", entityId: payId, after: { ...body, allocations: alloc.allocations, unallocated: alloc.remaining }, ip: clientIp(req) });
  res.json({ paymentId: payId, receiptNo, allocations: alloc.allocations, unallocated: alloc.remaining });
}));

lmsRouter.post("/payments/:id/reverse", requirePerm("payments.reverse"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ reason: z.string().min(3) }).parse(req.body);
  const pay = await q1<Record<string, any>>("SELECT * FROM payments WHERE id = ?", [req.params.id]);
  if (!pay) { res.status(404).json({ error: "Payment not found" }); return; }
  if (pay.reversed) { res.status(400).json({ error: "Payment already reversed" }); return; }
  // Never delete — mark reversed and restore installment state (immutability pattern)
  const before = { ...pay };
  await run("UPDATE payments SET reversed = 1, reversal_reason = ?, status = 'reversed' WHERE id = ?", [body.reason, pay.id]);
  const allocs = await q("SELECT * FROM payment_allocations WHERE payment_id = ?", [pay.id]);
  for (const a of allocs) {
    if (a.installment_id) {
      const inst = await q1<Record<string, any>>("SELECT * FROM installments WHERE id = ?", [a.installment_id]);
      if (inst) {
        const newPaid = inst.paid_amount - a.amount;
        await run("UPDATE installments SET paid_amount = ?, paid = 0, status = 'pending', paid_at = NULL WHERE id = ?", [Math.max(0, newPaid), inst.id]);
      }
    }
  }
  await refreshLoanState(pay.loan_id);
  await recordLoanEvent(pay.loan_id, "reversal", { tenantId: req.user!.tenant_id, amount: -pay.amount, reference: pay.receipt_no, data: { reason: body.reason, original_payment: pay.id }, userId: req.user!.id });
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "payment.reverse", entityType: "payment", entityId: pay.id, before, after: { reason: body.reason }, ip: clientIp(req) });
  res.json({ ok: true });
}));

/* ---------- CHARGES ---------- */

lmsRouter.post("/loans/:id/charges", requirePerm("payments.record"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ kind: z.enum(["penal_interest", "late_fee", "bounce_fee", "collection_fee", "other"]), amount: z.number().int().positive(), reason: z.string() }).parse(req.body);
  const loan = await q1<Record<string, any>>("SELECT * FROM loans WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  await run("INSERT INTO charge_events (tenant_id, loan_id, kind, amount, reason) VALUES (?, ?, ?, ?, ?)", [req.user!.tenant_id, loan.id, body.kind, body.amount, body.reason]);
  await recordLoanEvent(loan.id, "charge", { tenantId: req.user!.tenant_id, amount: body.amount, data: { kind: body.kind, reason: body.reason }, userId: req.user!.id });
  if (body.kind === "penal_interest" || body.kind === "other") await run("UPDATE loans SET penal_due = penal_due + ? WHERE id = ?", [body.amount, loan.id]);
  if (body.kind === "late_fee" || body.kind === "bounce_fee" || body.kind === "collection_fee") await run("UPDATE loans SET fees_due = fees_due + ? WHERE id = ?", [body.amount, loan.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: `charge.${body.kind}`, entityType: "loan", entityId: loan.id, after: body, ip: clientIp(req) });
  res.json({ ok: true });
}));

/* ---------- PTP ---------- */

lmsRouter.post("/loans/:id/ptp", requirePerm("collections.edit"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ amount: z.number().int().positive(), due_date: z.string(), note: z.string().optional() }).parse(req.body);
  const loan = await q1<Record<string, any>>("SELECT * FROM loans WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  const id = (await run("INSERT INTO ptps (loan_id, customer_id, amount, due_date, status, agent_id, note) VALUES (?, ?, ?, ?, 'promised', ?, ?)",
    [loan.id, loan.customer_id, body.amount, body.due_date, req.user!.id, body.note ?? null])).lastId;
  await run("INSERT INTO notifications (tenant_id, title, body) VALUES (?, 'PTP recorded', ?)", [req.user!.tenant_id, `Promise to pay ${inrShort(body.amount)} by ${body.due_date} on ${loan.loan_no}`]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "collections.ptp_create", entityType: "ptp", entityId: id, after: body, ip: clientIp(req) });
  res.json({ id });
}));

lmsRouter.patch("/ptps/:id", requirePerm("collections.edit"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ status: z.enum(["kept", "broken"]), note: z.string().optional() }).parse(req.body);
  const ptp = await q1("SELECT * FROM ptps WHERE id = ?", [req.params.id]);
  if (!ptp) { res.status(404).json({ error: "PTP not found" }); return; }
  await run("UPDATE ptps SET status = ? WHERE id = ?", [body.status, ptp.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: `ptp.${body.status}`, entityType: "ptp", entityId: ptp.id, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM ptps WHERE id = ?", [ptp.id]));
}));

/* ---------- FORECLOSURE ---------- */

lmsRouter.post("/loans/:id/foreclosure", requirePerm("payments.record"), asyncH(async (req: AuthedRequest, res) => {
  const loan = await q1<Record<string, any>>("SELECT * FROM loans WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  const insts = await q<Record<string, any>>("SELECT * FROM installments WHERE loan_id = ? ORDER BY seq", [loan.id]);
  const product = await q1<Record<string, any>>("SELECT * FROM products WHERE id = ?", [loan.product_id])!;
  const quote = foreclosureQuote(
    { principal: loan.principal, rate: loan.rate, outstanding: loan.outstanding, penalDue: loan.penal_due, feesDue: loan.fees_due },
    insts.map((i) => ({ seq: i.seq, dueDate: i.due_date, principal: i.principal, interest: i.interest, paid: i.paid, paidAmount: i.paid_amount })),
    today(), { foreclosureChargePct: product.foreclosure_charge_pct || 3 }
  );
  res.json({ quote, allowed: !!product.prepayment_allowed });
}));

lmsRouter.post("/loans/:id/foreclose", requirePerm("payments.record"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ amount: z.number().int().positive() }).parse(req.body);
  const loan = await q1<Record<string, any>>("SELECT * FROM loans WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  const insts = await q<Record<string, any>>("SELECT * FROM installments WHERE loan_id = ? ORDER BY seq", [loan.id]);
  const product = await q1<Record<string, any>>("SELECT * FROM products WHERE id = ?", [loan.product_id])!;
  const quote = foreclosureQuote(
    { principal: loan.principal, rate: loan.rate, outstanding: loan.outstanding, penalDue: loan.penal_due, feesDue: loan.fees_due },
    insts.map((i) => ({ seq: i.seq, dueDate: i.due_date, principal: i.principal, interest: i.interest, paid: i.paid, paidAmount: i.paid_amount })),
    today(), { foreclosureChargePct: product.foreclosure_charge_pct || 3 }
  );
  if (body.amount < quote.finalPayable) {
    res.status(400).json({ error: `Amount below foreclosure quote (${inrShort(quote.finalPayable)})` });
    return;
  }
  const receiptNo = "RCT" + new Date().getFullYear().toString().slice(2) + String(Math.floor(100000 + Math.random() * 899999));
  const payId = (await run(
    "INSERT INTO payments (tenant_id, loan_id, customer_id, receipt_no, amount, mode, reference, status, received_at, recorded_by) VALUES (?, ?, ?, ?, ?, 'neft', 'foreclosure', 'received', datetime('now'), ?)",
    [req.user!.tenant_id, loan.id, loan.customer_id, receiptNo, body.amount, req.user!.id]
  )).lastId;
  for (const inst of insts) {
    if (inst.paid === 0) {
      await run("UPDATE installments SET paid_amount = total, paid = 1, status = 'paid', paid_at = datetime('now') WHERE id = ?", [inst.id]);
      await run("INSERT INTO payment_allocations (payment_id, installment_id, component, amount) VALUES (?, ?, 'principal', ?)", [payId, inst.id, inst.principal]);
      if (inst.interest > 0) await run("INSERT INTO payment_allocations (payment_id, installment_id, component, amount) VALUES (?, ?, 'interest', ?)", [payId, inst.id, inst.interest]);
    }
  }
  if (quote.foreclosureCharge > 0) await run("INSERT INTO payment_allocations (payment_id, installment_id, component, amount) VALUES (?, NULL, 'principal', ?)", [payId, quote.foreclosureCharge]);
  await run("UPDATE loans SET status = 'closed', closed_at = datetime('now'), outstanding = 0, penal_due = 0, fees_due = 0 WHERE id = ?", [loan.id]);
  await recordLoanEvent(loan.id, "closure", { tenantId: req.user!.tenant_id, amount: body.amount, reference: receiptNo, data: { kind: "foreclosure", ...quote }, userId: req.user!.id });
  await run("INSERT INTO notifications (tenant_id, title, body) VALUES (?, 'Loan closed', ?)", [req.user!.tenant_id, `${loan.loan_no} closed via foreclosure (${inrShort(body.amount)})`]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "loan.foreclose", entityType: "loan", entityId: loan.id, after: { ...quote, paid: body.amount }, ip: clientIp(req) });
  res.json({ ok: true, quote });
}));

/* ---------- RESTRUCTURING ---------- */

lmsRouter.post("/loans/:id/restructure", requirePerm("loans.edit"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ new_tenure: z.number().int().positive(), reason: z.string(), moratorium_months: z.number().int().min(0).max(6).optional() }).parse(req.body);
  const loan = await q1<Record<string, any>>("SELECT * FROM loans WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  if (body.new_tenure <= loan.tenure) { res.status(400).json({ error: "New tenure must extend beyond current tenure" }); return; }
  const insts = await q<Record<string, any>>("SELECT * FROM installments WHERE loan_id = ? ORDER BY seq", [loan.id]);
  const outstanding = insts.filter((i) => i.paid === 0).reduce((s, i) => s + i.principal, 0);
  const remaining = body.new_tenure - loan.tenure;
  // Append extension installments at same EMI; versioned audit — original rows untouched
  let baseSeq = insts.length;
  let due = new Date(insts[insts.length - 1].due_date + "T00:00:00");
  const r = loan.rate / 100 / 12;
  for (let i = 0; i < remaining; i++) {
    due.setMonth(due.getMonth() + 1);
    const interest = Math.round(outstanding * r);
    const principal = loan.emi - interest;
    baseSeq += 1;
    await run("INSERT INTO installments (loan_id, seq, due_date, principal, interest, fees, total, status) VALUES (?, ?, ?, ?, ?, 0, ?, 'pending')",
      [loan.id, baseSeq, due.toISOString().slice(0, 10), Math.max(0, principal), interest, Math.max(0, principal) + interest]);
  }
  await run("UPDATE loans SET tenure = ?, restructured = 1, status = 'restructured', updated_at = datetime('now') WHERE id = ?", [body.new_tenure, loan.id]);
  await refreshLoanState(loan.id);
  await recordLoanEvent(loan.id, "restructure", { tenantId: req.user!.tenant_id, amount: outstanding, data: { ...body, outstanding_at_restructure: outstanding }, userId: req.user!.id });
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "loan.restructure", entityType: "loan", entityId: loan.id, after: body, ip: clientIp(req) });
  res.json({ ok: true });
}));

function inrShort(n: number): string {
  return "₹" + n.toLocaleString("en-IN");
}
