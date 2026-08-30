import { Router } from "express";
import { z } from "zod";
import { q, q1, run, now } from "../db/connection.js";
import { audit } from "../core/audit.js";
import { asyncH, authRequired, clientIp, requirePerm, type AuthedRequest } from "../middleware.js";
import { refreshLoanState } from "./lms.js";

export const reconRouter = Router();
reconRouter.use(authRequired);

const txnSchema = z.object({
  txn_date: z.string(), amount: z.number().int().positive(), mode: z.string(),
  reference: z.string().optional(), account_suffix: z.string().optional(), payer_name: z.string().optional()
});

/**
 * Import a bank/gateway statement batch and auto-match against recorded
 * payments. Matching is deterministic: reference first, then amount+payer.
 * Any payment that is already matched by an earlier row is flagged duplicate.
 */
reconRouter.post("/recon/import", requirePerm("payments.*"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ source: z.string(), transactions: z.array(txnSchema).min(1) }).parse(req.body);
  const t = req.user!.tenant_id;
  const batchNo = "RCN" + new Date().getFullYear().toString().slice(2) + String(10000 + Math.floor(Math.random() * 89999));
  const totalAmount = body.transactions.reduce((s, x) => s + x.amount, 0);
  const batchId = (await run(
    "INSERT INTO recon_batches (tenant_id, batch_no, source, total_transactions, total_amount, status, imported_by) VALUES (?, ?, ?, ?, ?, 'imported', ?)",
    [t, batchNo, body.source, body.transactions.length, totalAmount, req.user!.id]
  )).lastId;

  const matchedByPayment = new Set<number>();
  const results: Record<string, any>[] = [];

  for (const tx of body.transactions) {
    let status = "unmatched";
    let matchType: string | null = null;
    let paymentId: number | null = null;
    let confidence: number | null = null;
    let note: string | null = null;

    // 1. Exact reference match
    let pay: Record<string, any> | undefined;
    if (tx.reference) {
      pay = await q1<Record<string, any>>(
        `SELECT p.*, c.name AS customer_name, l.loan_no FROM payments p
         JOIN customers c ON c.id = p.customer_id JOIN loans l ON l.id = p.loan_id
         WHERE p.tenant_id = ? AND (p.reference = ? OR p.receipt_no = ?) AND p.reversed = 0 AND p.status = 'received'
         ORDER BY p.id DESC LIMIT 1`, [t, tx.reference, tx.reference]);
    }
    // 2. Amount + payer-name match
    if (!pay && tx.payer_name) {
      const candidates = await q<Record<string, any>>(
        `SELECT p.*, c.name AS customer_name, l.loan_no FROM payments p
         JOIN customers c ON c.id = p.customer_id JOIN loans l ON l.id = p.loan_id
         WHERE p.tenant_id = ? AND p.amount = ? AND p.reversed = 0 AND p.status = 'received'
           AND (LOWER(c.name) LIKE LOWER(?) OR LOWER(c.mobile) LIKE LOWER(?))
         ORDER BY ABS(julianday(p.received_at) - julianday(?)) LIMIT 1`,
        [t, tx.amount, `%${tx.payer_name}%`, `%${tx.payer_name.replace(/\s/g, "")}%`, tx.txn_date]);
      if (candidates.length) {
        pay = candidates[0];
        matchType = "auto_amount";
        confidence = 0.9;
      }
    }
    if (pay) {
      matchType = matchType ?? "auto_reference";
      confidence = confidence ?? 1;
      if (matchedByPayment.has(pay.id)) {
        status = "duplicate";
        note = `Duplicate of an already matched transaction (payment ${pay.receipt_no})`;
      } else {
        status = "matched";
        matchedByPayment.add(pay.id);
      }
      paymentId = pay.id;
    }
    const id = (await run(
      "INSERT INTO recon_transactions (tenant_id, batch_id, txn_date, amount, mode, reference, account_suffix, payer_name, status, match_type, payment_id, loan_id, customer_id, confidence, note, reconciled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [t, batchId, tx.txn_date, tx.amount, tx.mode, tx.reference ?? null, tx.account_suffix ?? null, tx.payer_name ?? null,
       status, matchType, paymentId, pay?.loan_id ?? null, pay?.customer_id ?? null, confidence, note,
       status === "matched" ? now() : null]
    )).lastId;
    results.push({ id, status, match_type: matchType, payment_id: paymentId, note });
  }
  const summary = await q1<Record<string, any>>(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'matched' THEN 1 ELSE 0 END) AS matched,
            SUM(CASE WHEN status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched,
            SUM(CASE WHEN status = 'duplicate' THEN 1 ELSE 0 END) AS duplicates
     FROM recon_transactions WHERE batch_id = ?`, [batchId]);
  await audit({ tenantId: t, userId: req.user!.id, action: "recon.import", entityType: "recon_batch", entityId: batchId, after: { batchNo, transactions: body.transactions.length, summary }, ip: clientIp(req) });
  res.json({ batch_id: batchId, batch_no: batchNo, summary, results });
}));

reconRouter.get("/recon/transactions", requirePerm("payments.view"), asyncH(async (req: AuthedRequest, res) => {
  const { status, q: query, page = 1, limit = 25 } = req.query as Record<string, string>;
  const where = ["r.tenant_id = ?"];
  const params: unknown[] = [req.user!.tenant_id];
  if (status) { where.push("r.status = ?"); params.push(status); }
  if (query) { where.push("(r.reference LIKE ? OR r.payer_name LIKE ? OR p.receipt_no LIKE ? OR c.name LIKE ?)"); params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`); }
  const total = (await q1<{ n: number }>(`SELECT COUNT(*) AS n FROM recon_transactions r LEFT JOIN payments p ON p.id = r.payment_id LEFT JOIN customers c ON c.id = r.customer_id WHERE ${where.join(" AND ")}`, params))!.n;
  const rows = await q<Record<string, any>>(
    `SELECT r.*, b.batch_no, b.source AS batch_source,
            p.receipt_no, p.mode AS payment_mode, p.status AS payment_status,
            l.loan_no, c.name AS customer_name
     FROM recon_transactions r
     LEFT JOIN recon_batches b ON b.id = r.batch_id
     LEFT JOIN payments p ON p.id = r.payment_id
     LEFT JOIN loans l ON l.id = r.loan_id
     LEFT JOIN customers c ON c.id = r.customer_id
     WHERE ${where.join(" AND ")}
     ORDER BY r.txn_date DESC, r.id DESC LIMIT ? OFFSET ?`,
    [...params, Number(limit), (Math.max(1, Number(page)) - 1) * Number(limit)]
  );
  res.json({ rows, total, page: Number(page), limit: Number(limit) });
}));

reconRouter.get("/recon/stats", requirePerm("payments.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = req.user!.tenant_id;
  const byStatus = await q<Record<string, any>>(
    `SELECT status, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amount FROM recon_transactions WHERE tenant_id = ? GROUP BY status`, [t]);
  const stats: Record<string, { count: number; amount: number }> = {};
  for (const row of byStatus) stats[row.status] = { count: row.n, amount: row.amount };
  const totals = await q1<Record<string, any>>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(amount), 0) AS amount FROM recon_transactions WHERE tenant_id = ?`, [t]);
  const recent = await q<Record<string, any>>(
    `SELECT batch_no, source, total_transactions, total_amount, created_at FROM recon_batches WHERE tenant_id = ? ORDER BY id DESC LIMIT 5`, [t]);
  const matchedAmount = stats.matched?.amount ?? 0;
  res.json({ stats, total: totals!.total, totalAmount: totals!.amount, matchRate: totals!.total > 0 ? Math.round((stats.matched?.count ?? 0) / totals!.total * 1000) / 10 : 0, recent });
}));

/** Candidate payments for manual matching — shows possible matches per transaction. */
reconRouter.get("/recon/:id/candidates", requirePerm("payments.view"), asyncH(async (req: AuthedRequest, res) => {
  const tx = await q1<Record<string, any>>("SELECT * FROM recon_transactions WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
  const candidates = await q<Record<string, any>>(
    `SELECT p.id, p.receipt_no, p.amount, p.mode, p.reference, p.status, p.received_at, p.reversed,
            l.loan_no, c.name AS customer_name, c.mobile
     FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = p.customer_id
     WHERE p.tenant_id = ? AND p.reversed = 0
       AND (p.amount = ? OR p.reference = ? OR p.receipt_no = ? OR LOWER(c.name) LIKE LOWER(?))
     ORDER BY ABS(p.amount - ?), p.received_at DESC LIMIT 8`,
    [req.user!.tenant_id, tx.amount, tx.reference, tx.reference, tx.payer_name ? `%${tx.payer_name}%` : "%", tx.amount]);
  res.json({ transaction: tx, candidates });
}));

reconRouter.post("/recon/:id/match", requirePerm("payments.*"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ payment_id: z.number().int().positive() }).parse(req.body);
  const tx = await q1<Record<string, any>>("SELECT * FROM recon_transactions WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
  if (tx.status === "reversed") { res.status(400).json({ error: "Reversed transactions cannot be matched" }); return; }
  const pay = await q1<Record<string, any>>(
    `SELECT p.*, l.loan_no, c.name AS customer_name FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = p.customer_id
     WHERE p.id = ? AND p.tenant_id = ?`, [body.payment_id, req.user!.tenant_id]);
  if (!pay) { res.status(404).json({ error: "Payment not found" }); return; }
  if (pay.amount !== tx.amount) { res.status(400).json({ error: `Amount mismatch — transaction ${tx.amount}, payment ${pay.amount}` }); return; }
  const already = await q1<Record<string, any>>("SELECT * FROM recon_transactions WHERE payment_id = ? AND tenant_id = ? AND status = 'matched'", [pay.id, req.user!.tenant_id]);
  if (already) { res.status(400).json({ error: `Payment already matched by transaction #${already.id}` }); return; }
  await run("UPDATE recon_transactions SET status = 'matched', match_type = 'manual', payment_id = ?, loan_id = ?, customer_id = ?, confidence = 1, reconciled_at = ?, note = NULL WHERE id = ?",
    [pay.id, pay.loan_id, pay.customer_id, now(), tx.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "recon.match", entityType: "recon_transaction", entityId: tx.id, before: { status: tx.status }, after: { payment_id: pay.id, receipt_no: pay.receipt_no }, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM recon_transactions WHERE id = ?", [tx.id]));
}));

reconRouter.post("/recon/:id/unmatch", requirePerm("payments.*"), asyncH(async (req: AuthedRequest, res) => {
  const tx = await q1<Record<string, any>>("SELECT * FROM recon_transactions WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
  if (tx.status !== "matched") { res.status(400).json({ error: "Only matched transactions can be unmatched" }); return; }
  await run("UPDATE recon_transactions SET status = 'unmatched', match_type = 'none', payment_id = NULL, loan_id = NULL, customer_id = NULL, confidence = NULL, reconciled_at = NULL WHERE id = ?", [tx.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "recon.unmatch", entityType: "recon_transaction", entityId: tx.id, before: { status: tx.status, payment_id: tx.payment_id }, after: { status: "unmatched" }, ip: clientIp(req) });
  res.json({ ok: true });
}));

/** Reversing a bank transaction un-matches it and reverses the linked payment (never deletes history). */
reconRouter.post("/recon/:id/reverse", requirePerm("payments.reverse"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ reason: z.string().min(3) }).parse(req.body);
  const tx = await q1<Record<string, any>>("SELECT * FROM recon_transactions WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
  if (tx.status === "reversed") { res.status(400).json({ error: "Already reversed" }); return; }
  let reversedPayment = false;
  if (tx.payment_id) {
    const pay = await q1<Record<string, any>>("SELECT * FROM payments WHERE id = ?", [tx.payment_id]);
    if (pay && !pay.reversed) {
      await run("UPDATE payments SET reversed = 1, reversal_reason = ?, status = 'reversed' WHERE id = ?", [body.reason, pay.id]);
      const allocs = await q("SELECT * FROM payment_allocations WHERE payment_id = ?", [pay.id]);
      for (const a of allocs) {
        if (a.installment_id) {
          const inst = await q1<Record<string, any>>("SELECT * FROM installments WHERE id = ?", [a.installment_id]);
          if (inst) {
            const newPaid = Math.max(0, inst.paid_amount - a.amount);
            await run("UPDATE installments SET paid_amount = ?, paid = 0, status = 'pending', paid_at = NULL WHERE id = ?", [newPaid, inst.id]);
          }
        }
      }
      await refreshLoanState(pay.loan_id);
      reversedPayment = true;
    }
  }
  await run("UPDATE recon_transactions SET status = 'reversed', reversed_at = datetime('now'), note = ? WHERE id = ?", [body.reason, tx.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "recon.reverse", entityType: "recon_transaction", entityId: tx.id, before: { status: tx.status, payment_id: tx.payment_id }, after: { reason: body.reason, reversed_payment: reversedPayment }, ip: clientIp(req) });
  res.json({ ok: true, reversed_payment: reversedPayment });
}));

reconRouter.post("/recon/:id/resolve", requirePerm("payments.*"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ note: z.string().min(2) }).parse(req.body);
  const tx = await q1<Record<string, any>>("SELECT * FROM recon_transactions WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
  await run("UPDATE recon_transactions SET note = ?, status = CASE WHEN status = 'requires_review' THEN 'unmatched' ELSE status END WHERE id = ?", [body.note, tx.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "recon.resolve", entityType: "recon_transaction", entityId: tx.id, after: body, ip: clientIp(req) });
  res.json({ ok: true });
}));

reconRouter.get("/recon/export", requirePerm("payments.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT r.txn_date, r.amount, r.mode, r.reference, r.account_suffix, r.payer_name, r.status, r.match_type,
            p.receipt_no, l.loan_no, c.name AS customer_name
     FROM recon_transactions r
     LEFT JOIN payments p ON p.id = r.payment_id
     LEFT JOIN loans l ON l.id = r.loan_id
     LEFT JOIN customers c ON c.id = r.customer_id
     WHERE r.tenant_id = ? ORDER BY r.id`, [req.user!.tenant_id]);
  const header = "txn_date,amount,mode,reference,account_suffix,payer_name,status,match_type,receipt_no,loan_no,customer_name";
  const lines = rows.map((r) => [r.txn_date, r.amount, r.mode, r.reference ?? "", r.account_suffix ?? "", r.payer_name ?? "", r.status, r.match_type ?? "", r.receipt_no ?? "", r.loan_no ?? "", r.customer_name ?? ""].join(","));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=nexus-recon.csv");
  res.send([header, ...lines].join("\n"));
}));

/** Payments available for manual matching. */
reconRouter.get("/recon/payments", requirePerm("payments.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT p.id, p.receipt_no, p.amount, p.mode, p.reference, p.status, p.received_at, p.reversed,
            l.loan_no, c.name AS customer_name
     FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = p.customer_id
     WHERE p.tenant_id = ? AND p.reversed = 0 ORDER BY p.received_at DESC LIMIT 100`, [req.user!.tenant_id]);
  res.json({ rows });
}));
