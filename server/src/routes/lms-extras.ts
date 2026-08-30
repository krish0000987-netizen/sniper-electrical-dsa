import { Router } from "express";
import { z } from "zod";
import { q, q1, run, now } from "../db/connection.js";
import { audit } from "../core/audit.js";
import { asyncH, authRequired, clientIp, requirePerm, type AuthedRequest } from "../middleware.js";
import { computeEmi, computeDpd, foreclosureQuote } from "../core/finance.js";
import { recordLoanEvent, inrShort } from "../core/engines.js";
import { refreshLoanState } from "./lms.js";

export const lmsExtrasRouter = Router();
lmsExtrasRouter.use(authRequired);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadLoan(req: AuthedRequest, id: string) {
  return await q1<Record<string, any>>(
    `SELECT l.*, c.name AS customer_name, c.mobile, c.email, c.address_line1, c.city, c.state, c.pan,
            p.name AS product_name, p.category, p.foreclosure_charge_pct, p.prepayment_allowed,
            p.part_payment_min_amount, p.allocation_order, p.emi_frequency
     FROM loans l JOIN customers c ON c.id = l.customer_id JOIN products p ON p.id = l.product_id
     WHERE l.id = ? AND l.tenant_id = ?`, [id, req.user!.tenant_id]);
}

/* ---------- Loan closure engine ---------- */

lmsExtrasRouter.get("/loans/:id/closure", requirePerm("loans.view"), asyncH(async (req: AuthedRequest, res) => {
  const loan = await loadLoan(req, req.params.id);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  await refreshLoanState(loan.id);
  const insts = await q<Record<string, any>>("SELECT * FROM installments WHERE loan_id = ? ORDER BY seq", [loan.id]);
  const unpaid = insts.filter((i) => i.paid === 0);
  const totalDue = unpaid.reduce((s, i) => s + (i.total - i.paid_amount), 0);
  const closure = await q1<Record<string, any>>("SELECT * FROM closures WHERE loan_id = ? ORDER BY id DESC LIMIT 1", [loan.id]);
  res.json({ loan, total_due: totalDue, unpaid_installments: unpaid.length, closure });
}));

lmsExtrasRouter.post("/loans/:id/closure", requirePerm("payments.record"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ }).parse(req.body ?? {});
  const loan = await loadLoan(req, req.params.id);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  await refreshLoanState(loan.id);
  const insts = await q<Record<string, any>>("SELECT * FROM installments WHERE loan_id = ? ORDER BY seq", [loan.id]);
  const unpaid = insts.filter((i) => i.paid === 0);
  const totalDue = unpaid.reduce((s, i) => s + (i.total - i.paid_amount), 0);
  if (totalDue > 0) { res.status(400).json({ error: `Outstanding dues of ${inrShort(totalDue)} must be cleared before closure` }); return; }
  if (loan.status === "closed") { res.status(400).json({ error: "Loan already closed" }); return; }
  const statement = [
    `LOAN CLOSURE STATEMENT — ${loan.loan_no}`,
    `Customer: ${loan.customer_name} (${loan.mobile})`,
    `Product: ${loan.product_name} | Principal: ${inrShort(loan.principal)} | Rate: ${loan.rate}% p.a.`,
    `Disbursed: ${loan.disbursed_at?.slice(0, 10)} | Outstanding: ${inrShort(loan.outstanding ?? 0)} | DPD: ${loan.dpd}`,
    `All ${loan.tenure} installment(s) fully paid as of ${today()}.`,
    `No outstanding principal, interest, fees or penal charges remain.`,
    `Status: ELIGIBLE FOR CLOSURE`
  ].join("\n");
  const noc = [
    `NO OBJECTION CERTIFICATE — ${loan.loan_no}`,
    `NEXUS {tenant} certifies that all dues under the above loan stand fully settled.`,
    `Customer: ${loan.customer_name} | PAN: ${loan.pan ?? "—"} | Loan amount: ${inrShort(loan.principal)}`,
    `The loan is closed with no outstanding liability. Any lien / hypothecation / charge created against`,
    `the security (if any) stands released subject to completion of applicable security release formalities.`,
    `Date: ${today()}`,
    `This is a system-generated demo NOC.`,
  ].join("\n");
  const id = (await run("INSERT INTO closures (tenant_id, loan_id, statement, noc, status, created_at) VALUES (?, ?, ?, ?, 'requested', datetime('now'))",
    [req.user!.tenant_id, loan.id, statement, noc])).lastId;
  await run("INSERT INTO notifications (tenant_id, title, body) VALUES (?, 'Closure requested', ?)", [req.user!.tenant_id, `${loan.loan_no} closure requested — awaiting approval`]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "closure.request", entityType: "loan", entityId: loan.id, after: { closure_id: id, total_due: totalDue }, ip: clientIp(req) });
  res.json({ id, statement, noc });
}));

lmsExtrasRouter.post("/loans/:id/closure/approve", requirePerm("loans.edit"), asyncH(async (req: AuthedRequest, res) => {
  const loan = await loadLoan(req, req.params.id);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  const closure = await q1<Record<string, any>>("SELECT * FROM closures WHERE loan_id = ? ORDER BY id DESC LIMIT 1", [loan.id]);
  if (!closure) { res.status(400).json({ error: "No closure request found" }); return; }
  if (closure.status === "closed") { res.status(400).json({ error: "Already closed" }); return; }
  await run("UPDATE closures SET status = 'closed', approved_by = ?, closed_at = datetime('now') WHERE id = ?", [req.user!.id, closure.id]);
  await run("UPDATE loans SET status = 'closed', closed_at = datetime('now'), outstanding = 0, dpd = 0, npa_class = NULL WHERE id = ?", [loan.id]);
  await run("INSERT INTO approvals (tenant_id, entity_type, entity_id, action, status, by_user) VALUES (?, 'closure', ?, 'close', 'approved', ?)", [req.user!.tenant_id, closure.id, req.user!.id]);
  await recordLoanEvent(loan.id, "closure", { tenantId: req.user!.tenant_id, amount: 0, reference: loan.loan_no, data: { closure_id: closure.id }, userId: req.user!.id });
  await run("INSERT INTO notifications (tenant_id, title, body) VALUES (?, 'Loan closed', ?)", [req.user!.tenant_id, `${loan.loan_no} closed — NOC generated`]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "closure.approve", entityType: "loan", entityId: loan.id, before: { status: loan.status }, after: { status: "closed" }, ip: clientIp(req) });
  res.json({ ok: true });
}));

/* ---------- Top-up eligibility ---------- */

lmsExtrasRouter.get("/loans/:id/topup", requirePerm("loans.view"), asyncH(async (req: AuthedRequest, res) => {
  const loan = await loadLoan(req, req.params.id);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  await refreshLoanState(loan.id);
  const insts = await q<Record<string, any>>("SELECT * FROM installments WHERE loan_id = ? ORDER BY seq", [loan.id]);
  const due = computeDpd(insts.map((i) => ({ dueDate: i.due_date, paid: i.paid, paidAmount: i.paid_amount })), today());
  const paidCount = insts.filter((i) => i.paid === 1).length;
  const missedCount = insts.filter((i) => i.paid === 0 && i.due_date <= today()).length;
  const monthsServiced = paidCount;
  const product = await q1<Record<string, any>>("SELECT * FROM products WHERE id = ?", [loan.product_id])!;
  const cust = await q1<Record<string, any>>("SELECT * FROM customers WHERE id = ?", [loan.customer_id]);
  const bureau = await q1<Record<string, any>>("SELECT * FROM bureau_reports WHERE customer_id = ? ORDER BY id DESC LIMIT 1", [loan.customer_id]);
  const income = cust?.monthly_income ?? 0;
  const checks: Record<string, any>[] = [
    { key: "history", label: "Repayment history", value: `${paidCount}/${insts.length} installments paid`, passed: missedCount === 0, hard: true },
    { key: "dpd", label: "Current DPD", value: due.bucket, passed: due.missedInstallments === 0, hard: true },
    { key: "serviced", label: "Months serviced", value: `${monthsServiced} months`, passed: monthsServiced >= 6, hard: true },
    { key: "status", label: "Loan status", value: loan.status, passed: ["active", "restructured"].includes(loan.status), hard: true },
    { key: "bureau", label: "Bureau score", value: bureau ? String(bureau.score) : "n/a", passed: bureau ? bureau.score >= 650 : true, hard: false },
    { key: "income", label: "Income", value: inrShort(income), passed: income >= 20000, hard: false }
  ];
  const failed = checks.filter((c) => !c.passed);
  const eligible = failed.length === 0;
  const outstanding = loan.outstanding ?? 0;
  const maxTopup = Math.max(0, Math.min(product.max_amount - outstanding, Math.round((loan.principal * 0.5) / 5000) * 5000));
  const emi = computeEmi(maxTopup || loan.emi, loan.rate, Math.min(product.max_tenure, 36));
  res.json({
    eligible,
    reasons: failed.map((c) => `${c.label}: ${c.value}`),
    checks,
    offer: eligible ? { amount: maxTopup, tenure: Math.min(product.max_tenure, 36), rate: loan.rate, emi } : null,
    outstanding, months_serviced: monthsServiced
  });
}));

/* ---------- Loan statement (ledger) ---------- */

lmsExtrasRouter.get("/loans/:id/statement", requirePerm("loans.view"), asyncH(async (req: AuthedRequest, res) => {
  const loan = await loadLoan(req, req.params.id);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  await refreshLoanState(loan.id);
  const refreshed = await q1<Record<string, any>>("SELECT * FROM loans WHERE id = ?", [loan.id]);
  const insts = await q<Record<string, any>>("SELECT * FROM installments WHERE loan_id = ? ORDER BY seq", [loan.id]);
  const payments = await q<Record<string, any>>("SELECT * FROM payments WHERE loan_id = ? ORDER BY received_at", [loan.id]);
  const charges = await q<Record<string, any>>("SELECT * FROM charge_events WHERE loan_id = ? ORDER BY id", [loan.id]);
  const events = await q<Record<string, any>>("SELECT * FROM loan_events WHERE loan_id = ? ORDER BY id", [loan.id]);
  const ledger = [
    ...payments.map((p) => ({ date: p.received_at?.slice(0, 10), type: "payment", ref: p.receipt_no, amount: p.amount, status: p.status })),
    ...charges.map((c) => ({ date: c.created_at?.slice(0, 10), type: `charge:${c.kind}`, ref: "", amount: c.amount, status: c.status })),
    ...events.map((e) => ({ date: e.created_at?.slice(0, 10), type: e.kind, ref: e.reference ?? "", amount: e.amount ?? 0, status: "event" }))
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const totalPaid = payments.filter((p) => !p.reversed).reduce((s, p) => s + p.amount, 0);
  const totalCharged = charges.reduce((s, c) => s + c.amount, 0);
  res.json({
    loan: { ...loan, ...(refreshed ?? {}) },
    summary: { principal: loan.principal, total_paid: totalPaid, total_charged: totalCharged, outstanding: (refreshed ?? {}).outstanding ?? 0, next_due: insts.find((i) => i.paid === 0)?.due_date ?? null },
    ledger,
    installments: insts,
    payments,
    charges,
    events
  });
}));

/* ---------- Foreclosure statement (document output) ---------- */

lmsExtrasRouter.get("/loans/:id/foreclosure-statement", requirePerm("loans.view"), asyncH(async (req: AuthedRequest, res) => {
  const loan = await loadLoan(req, req.params.id);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  await refreshLoanState(loan.id);
  const insts = await q<Record<string, any>>("SELECT * FROM installments WHERE loan_id = ? ORDER BY seq", [loan.id]);
  const product = await q1<Record<string, any>>("SELECT * FROM products WHERE id = ?", [loan.product_id])!;
  const quote = foreclosureQuote(
    { principal: loan.principal, rate: loan.rate, outstanding: loan.outstanding, penalDue: loan.penal_due, feesDue: loan.fees_due },
    insts.map((i) => ({ seq: i.seq, dueDate: i.due_date, principal: i.principal, interest: i.interest, paid: i.paid, paidAmount: i.paid_amount })),
    today(), { foreclosureChargePct: product.foreclosure_charge_pct || 3 }
  );
  const statement = [
    `FORECLOSURE / PREPAYMENT STATEMENT — ${loan.loan_no}`,
    `Customer: ${loan.customer_name} | Product: ${loan.product_name}`,
    `Principal outstanding: ${inrShort(quote.principalOutstanding)}`,
    `Accrued interest (to date): ${inrShort(quote.accruedInterest)}`,
    `Penal / other dues: ${inrShort(quote.penalDue + quote.feesDue)}`,
    `Foreclosure charge (${product.foreclosure_charge_pct || 3}%): ${inrShort(quote.foreclosureCharge)}`,
    `Rebate: ${inrShort(quote.rebate)}`,
    `Final payable: ${inrShort(quote.finalPayable)}`,
    `Validity: 15 days from ${today()}. This is a demo statement.`
  ].join("\n");
  res.json({ quote, statement });
}));
