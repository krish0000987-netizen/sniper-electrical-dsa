import { Router } from "express";
import { z } from "zod";
import { q, q1, run, now } from "../db/connection.js";
import { audit } from "../core/audit.js";
import { asyncH, authRequired, clientIp, requirePerm, type AuthedRequest } from "../middleware.js";
import { allocatePayment, computeEmi, computeDpd, type AllocationComponent } from "../core/finance.js";
import { recordLoanEvent, slaStatus } from "../core/engines.js";
import { refreshLoanState } from "./lms.js";

export const portalRouter = Router();
portalRouter.use(authRequired);
// NOTE: no router-level role guard here — router.use() middleware would run for
// every /api request that reaches this mount. Role scoping happens inside each
// handler via requireCustomer().

/** Resolve the customer scoped to the session — customer users only ever see their own data. */
function scopedCustomer(req: AuthedRequest): { id: number } | null {
  const u = req.user!;
  if (u.role !== "customer") return null;
  if (!u.customer_id) return null;
  return { id: u.customer_id };
}

function requireCustomer(req: AuthedRequest): { id: number } | null {
  return scopedCustomer(req);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

portalRouter.get("/portal/summary", asyncH(async (req: AuthedRequest, res) => {
  const me = requireCustomer(req);
  if (!me) { res.status(403).json({ error: "Portal available for customer accounts only" }); return; }
  const cust = await q1<Record<string, any>>("SELECT * FROM customers WHERE id = ? AND tenant_id = ?", [me.id, req.user!.tenant_id]);
  if (!cust) { res.status(404).json({ error: "Customer profile not found" }); return; }
  const applications = await q<Record<string, any>>(
    `SELECT a.id, a.application_no, a.status, a.stage, a.requested_amount, a.created_at, p.name AS product_name
     FROM applications a JOIN products p ON p.id = a.product_id
     WHERE a.customer_id = ? ORDER BY a.id DESC LIMIT 10`, [me.id]);
  const loans = await q<Record<string, any>>(
    `SELECT l.id, l.loan_no, l.principal, l.outstanding, l.emi, l.dpd, l.status, l.disbursed_at, l.first_emi_at, p.name AS product_name
     FROM loans l JOIN products p ON p.id = l.product_id WHERE l.customer_id = ? ORDER BY l.id DESC LIMIT 10`, [me.id]);
  const nextDue = await q1<Record<string, any>>(
    `SELECT i.due_date, i.total, i.paid_amount FROM installments i JOIN loans l ON l.id = i.loan_id
     WHERE l.customer_id = ? AND i.paid = 0 ORDER BY i.seq LIMIT 1`, [me.id]);
  const docsPending = await q1<{ n: number }>("SELECT COUNT(*) AS n FROM documents WHERE customer_id = ? AND status NOT IN ('verified','rejected')", [me.id]);
  const complaints = await q<Record<string, any>>("SELECT id, complaint_no, category, status, created_at FROM complaints WHERE customer_id = ? ORDER BY id DESC LIMIT 5", [me.id]);
  const notifs = await q<Record<string, any>>("SELECT id, title, body, created_at, read FROM notifications WHERE user_id = ? OR (user_id IS NULL AND tenant_id = ?) ORDER BY id DESC LIMIT 8", [req.user!.id, req.user!.tenant_id]);
  const activeLoans = loans.filter((l) => ["active", "overdue", "restructured"].includes(l.status));
  const totalOutstanding = activeLoans.reduce((s, l) => s + (l.outstanding ?? 0), 0);
  res.json({
    customer: { id: cust.id, name: cust.name, customer_no: cust.customer_no, kyc_status: cust.kyc_status },
    applications, loans, next_due: nextDue ?? null, docs_pending: docsPending?.n ?? 0, complaints, notifications: notifs,
    totals: { active_loans: activeLoans.length, outstanding: totalOutstanding }
  });
}));

portalRouter.get("/portal/products", asyncH(async (req: AuthedRequest, res) => {
  const me = requireCustomer(req);
  if (!me) { res.status(403).json({ error: "Portal available for customer accounts only" }); return; }
  const rows = await q<Record<string, any>>(
    `SELECT id, code, name, category, min_amount, max_amount, min_tenure, max_tenure, interest_rate, processing_fee_pct
     FROM products WHERE tenant_id = ? AND status = 'active' ORDER BY id`, [req.user!.tenant_id]);
  res.json({ rows });
}));

portalRouter.post("/portal/apply", asyncH(async (req: AuthedRequest, res) => {
  const me = requireCustomer(req);
  if (!me) { res.status(403).json({ error: "Portal available for customer accounts only" }); return; }
  const body = z.object({
    product_id: z.number().int().positive(), requested_amount: z.number().int().positive(),
    tenure: z.number().int().positive(), purpose: z.string().optional(), monthly_income: z.number().optional()
  }).parse(req.body);
  const product = await q1<Record<string, any>>("SELECT * FROM products WHERE id = ? AND tenant_id = ?", [body.product_id, req.user!.tenant_id]);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  if (body.requested_amount < product.min_amount || body.requested_amount > product.max_amount) {
    res.status(400).json({ error: `Amount outside product band (${product.min_amount}–${product.max_amount})` }); return;
  }
  const appNo = "APP26" + String(100000 + Math.floor(Math.random() * 899999));
  const id = (await run(
    "INSERT INTO applications (tenant_id, application_no, customer_id, product_id, source, requested_amount, tenure, purpose, status, stage, created_at) VALUES (?, ?, ?, ?, 'customer_portal', ?, ?, ?, 'in_progress', 'application', datetime('now'))",
    [req.user!.tenant_id, appNo, me.id, body.product_id, body.requested_amount, body.tenure, body.purpose ?? null]
  )).lastId;
  await run("INSERT INTO application_stages (application_id, stage, entered_at, status) VALUES (?, 'application', datetime('now'), 'in_progress')", [id]);
  if (body.monthly_income) await run("UPDATE customers SET monthly_income = ? WHERE id = ?", [body.monthly_income, me.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "portal.application_create", entityType: "application", entityId: id, after: body, ip: clientIp(req) });
  await run("INSERT INTO notifications (tenant_id, title, body) VALUES (?, 'Application submitted', ?)", [req.user!.tenant_id, `${appNo} submitted — our team will contact you`]);
  res.json({ id, application_no: appNo });
}));

portalRouter.get("/portal/applications", asyncH(async (req: AuthedRequest, res) => {
  const me = requireCustomer(req);
  if (!me) { res.status(403).json({ error: "Portal available for customer accounts only" }); return; }
  const rows = await q<Record<string, any>>(
    `SELECT a.id, a.application_no, a.status, a.stage, a.requested_amount, a.approved_amount, a.tenure, a.rate,
            a.bre_result, a.decision, a.created_at, a.updated_at, p.name AS product_name, p.category
     FROM applications a JOIN products p ON p.id = a.product_id
     WHERE a.customer_id = ? ORDER BY a.id DESC`, [me.id]);
  res.json({ rows });
}));

portalRouter.get("/portal/applications/:id", asyncH(async (req: AuthedRequest, res) => {
  const me = requireCustomer(req);
  if (!me) { res.status(403).json({ error: "Portal available for customer accounts only" }); return; }
  const app = await q1<Record<string, any>>(
    `SELECT a.*, p.name AS product_name, p.category, p.interest_rate
     FROM applications a JOIN products p ON p.id = a.product_id WHERE a.id = ? AND a.customer_id = ?`, [req.params.id, me.id]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const stages = await q<Record<string, any>>("SELECT * FROM application_stages WHERE application_id = ? ORDER BY id", [app.id]);
  const docs = await q<Record<string, any>>("SELECT id, category, name, status, version, created_at FROM documents WHERE application_id = ?", [app.id]);
  const kfs = await q1<Record<string, any>>("SELECT * FROM kfs_documents WHERE application_id = ? ORDER BY version DESC LIMIT 1", [app.id]);
  const sanction = await q1<Record<string, any>>("SELECT * FROM sanctions WHERE application_id = ?", [app.id]);
  const sla = await slaStatus(app);
  res.json({ application: app, stages, documents: docs, kfs: kfs ? { ...kfs, content: JSON.parse(kfs.content) } : null, sanction, sla });
}));

portalRouter.get("/portal/loans", asyncH(async (req: AuthedRequest, res) => {
  const me = requireCustomer(req);
  if (!me) { res.status(403).json({ error: "Portal available for customer accounts only" }); return; }
  const rows = await q<Record<string, any>>(
    `SELECT l.id, l.loan_no, l.principal, l.outstanding, l.rate, l.tenure, l.emi, l.dpd, l.npa_class, l.status,
            l.disbursed_at, l.first_emi_at, l.closed_at, p.name AS product_name,
            (SELECT due_date FROM installments i WHERE i.loan_id = l.id AND i.paid = 0 ORDER BY i.seq LIMIT 1) AS next_due
     FROM loans l JOIN products p ON p.id = l.product_id WHERE l.customer_id = ? ORDER BY l.id DESC`, [me.id]);
  res.json({ rows });
}));

portalRouter.get("/portal/loans/:id", asyncH(async (req: AuthedRequest, res) => {
  const me = requireCustomer(req);
  if (!me) { res.status(403).json({ error: "Portal available for customer accounts only" }); return; }
  const loan = await q1<Record<string, any>>(
    `SELECT l.*, p.name AS product_name, p.category FROM loans l JOIN products p ON p.id = l.product_id
     WHERE l.id = ? AND l.customer_id = ?`, [req.params.id, me.id]);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  await refreshLoanState(loan.id);
  const installments = await q("SELECT * FROM installments WHERE loan_id = ? ORDER BY seq", [loan.id]);
  const payments = await q("SELECT * FROM payments WHERE loan_id = ? ORDER BY received_at DESC", [loan.id]);
  const charges = await q("SELECT * FROM charge_events WHERE loan_id = ? ORDER BY id DESC", [loan.id]);
  const statement = await q1<Record<string, any>>("SELECT * FROM closures WHERE loan_id = ? ORDER BY id DESC LIMIT 1", [loan.id]);
  res.json({ loan: await q1("SELECT * FROM loans WHERE id = ?", [loan.id]), installments, payments, charges, closure: statement });
}));

/** Demo sandbox payment from the customer portal — clearly marked, never a live charge. */
portalRouter.post("/portal/loans/:id/pay", asyncH(async (req: AuthedRequest, res) => {
  const me = requireCustomer(req);
  if (!me) { res.status(403).json({ error: "Portal available for customer accounts only" }); return; }
  const body = z.object({ amount: z.number().int().positive(), mode: z.string().default("upi") }).parse(req.body);
  const loan = await q1<Record<string, any>>("SELECT * FROM loans WHERE id = ? AND customer_id = ?", [req.params.id, me.id]);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  if (loan.status === "closed" || loan.written_off) { res.status(400).json({ error: "Loan is closed" }); return; }
  const product = await q1<Record<string, any>>("SELECT * FROM products WHERE id = ?", [loan.product_id])!;
  const insts = await q<Record<string, any>>("SELECT * FROM installments WHERE loan_id = ? ORDER BY seq", [loan.id]);
  const order = (product.allocation_order || "penalty,fees,interest,principal").split(",") as AllocationComponent[];
  const alloc = allocatePayment({
    amount: body.amount, order, penalDue: loan.penal_due, feesDue: loan.fees_due,
    installments: insts.map((i) => ({ seq: i.seq, total: i.total, paidAmount: i.paid_amount, interest: i.interest, principal: i.principal })),
    allowFuturePrincipal: true
  });
  const receiptNo = "RCT" + new Date().getFullYear().toString().slice(2) + String(Math.floor(100000 + Math.random() * 899999));
  const payId = (await run(
    "INSERT INTO payments (tenant_id, loan_id, customer_id, receipt_no, amount, mode, reference, status, received_at, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'received', datetime('now'), ?)",
    [req.user!.tenant_id, loan.id, loan.customer_id, receiptNo, body.amount, body.mode, "PORTAL-DEMO", req.user!.id]
  )).lastId;
  for (const a of alloc.allocations) {
    await run("INSERT INTO payment_allocations (payment_id, installment_id, component, amount) VALUES (?, ?, ?, ?)", [payId, a.seq ?? null, a.component, a.amount]);
    if (a.seq) {
      const inst = insts.find((i) => i.seq === a.seq);
      if (inst) {
        const newPaid = inst.paid_amount + a.amount;
        const full = newPaid >= inst.total;
        await run("UPDATE installments SET paid_amount = ?, paid = ?, status = ?, paid_at = datetime('now') WHERE id = ?", [newPaid, full ? 1 : 0, full ? "paid" : "part_paid", inst.id]);
      }
    }
  }
  await refreshLoanState(loan.id);
  await recordLoanEvent(loan.id, "payment", { tenantId: req.user!.tenant_id, amount: body.amount, reference: receiptNo, data: { channel: "customer_portal", mode: body.mode, sandbox: true }, userId: req.user!.id });
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "portal.payment_record", entityType: "payment", entityId: payId, after: { ...body, receipt_no: receiptNo, sandbox: true }, ip: clientIp(req) });
  res.json({ ok: true, receipt_no: receiptNo, sandbox: true, allocations: alloc.allocations, unallocated: alloc.remaining });
}));

portalRouter.get("/portal/documents", asyncH(async (req: AuthedRequest, res) => {
  const me = requireCustomer(req);
  if (!me) { res.status(403).json({ error: "Portal available for customer accounts only" }); return; }
  const rows = await q<Record<string, any>>(
    `SELECT d.id, d.category, d.name, d.status, d.version, d.created_at, d.verified_at, a.application_no
     FROM documents d LEFT JOIN applications a ON a.id = d.application_id
     WHERE d.customer_id = ? ORDER BY d.id DESC`, [me.id]);
  res.json({ rows });
}));

portalRouter.post("/portal/documents", asyncH(async (req: AuthedRequest, res) => {
  const me = requireCustomer(req);
  if (!me) { res.status(403).json({ error: "Portal available for customer accounts only" }); return; }
  const body = z.object({ application_id: z.number().int().positive(), category: z.string().min(2), name: z.string().min(1) }).parse(req.body);
  const app = await q1<Record<string, any>>("SELECT * FROM applications WHERE id = ? AND customer_id = ?", [body.application_id, me.id]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const id = (await run(
    "INSERT INTO documents (tenant_id, customer_id, application_id, category, name, file_path, status, version) VALUES (?, ?, ?, ?, ?, ?, 'uploaded', 1)",
    [req.user!.tenant_id, me.id, app.id, body.category, body.name, `portal/${app.application_no}/${body.category}.pdf`]
  )).lastId;
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "portal.document_upload", entityType: "document", entityId: id, after: { ...body, sandbox: true }, ip: clientIp(req) });
  await run("INSERT INTO notifications (tenant_id, title, body) VALUES (?, 'Document uploaded', ?)", [req.user!.tenant_id, `${body.name} uploaded — pending verification`]);
  res.json({ id });
}));

portalRouter.get("/portal/kfs/:applicationId", asyncH(async (req: AuthedRequest, res) => {
  const me = requireCustomer(req);
  if (!me) { res.status(403).json({ error: "Portal available for customer accounts only" }); return; }
  const app = await q1<Record<string, any>>("SELECT * FROM applications WHERE id = ? AND customer_id = ?", [req.params.applicationId, me.id]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const kfs = await q1<Record<string, any>>("SELECT * FROM kfs_documents WHERE application_id = ? ORDER BY version DESC LIMIT 1", [app.id]);
  if (!kfs) { res.status(404).json({ error: "KFS not generated yet" }); return; }
  res.json({ kfs: { ...kfs, content: JSON.parse(kfs.content) } });
}));

portalRouter.post("/portal/kfs/:applicationId/acknowledge", asyncH(async (req: AuthedRequest, res) => {
  const me = requireCustomer(req);
  if (!me) { res.status(403).json({ error: "Portal available for customer accounts only" }); return; }
  const app = await q1<Record<string, any>>("SELECT * FROM applications WHERE id = ? AND customer_id = ?", [req.params.applicationId, me.id]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const kfs = await q1<Record<string, any>>("SELECT * FROM kfs_documents WHERE application_id = ? ORDER BY version DESC LIMIT 1", [app.id]);
  if (!kfs) { res.status(404).json({ error: "KFS not generated yet" }); return; }
  await run("UPDATE kfs_documents SET acknowledged_at = datetime('now'), status = 'acknowledged' WHERE id = ?", [kfs.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "portal.kfs_acknowledge", entityType: "kfs_document", entityId: kfs.id, after: { application_id: app.id }, ip: clientIp(req) });
  res.json({ ok: true });
}));

portalRouter.get("/portal/complaints", asyncH(async (req: AuthedRequest, res) => {
  const me = requireCustomer(req);
  if (!me) { res.status(403).json({ error: "Portal available for customer accounts only" }); return; }
  const rows = await q<Record<string, any>>("SELECT * FROM complaints WHERE customer_id = ? ORDER BY id DESC", [me.id]);
  res.json({ rows });
}));

portalRouter.post("/portal/complaints", asyncH(async (req: AuthedRequest, res) => {
  const me = requireCustomer(req);
  if (!me) { res.status(403).json({ error: "Portal available for customer accounts only" }); return; }
  const body = z.object({ category: z.string().min(2), subject: z.string().min(5), description: z.string().min(10), priority: z.string().optional() }).parse(req.body);
  const complaintNo = "GRV26" + String(10000 + Math.floor(Math.random() * 89999));
  const id = (await run(
    "INSERT INTO complaints (tenant_id, customer_id, complaint_no, category, priority, status, subject, description) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)",
    [req.user!.tenant_id, me.id, complaintNo, body.category, body.priority ?? "medium", body.subject, body.description]
  )).lastId;
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "portal.complaint_create", entityType: "complaint", entityId: id, after: body, ip: clientIp(req) });
  res.json({ id, complaint_no: complaintNo });
}));

portalRouter.get("/portal/notifications", asyncH(async (req: AuthedRequest, res) => {
  const me = requireCustomer(req);
  if (!me) { res.status(403).json({ error: "Portal available for customer accounts only" }); return; }
  const rows = await q<Record<string, any>>("SELECT * FROM notifications WHERE user_id = ? OR (user_id IS NULL AND tenant_id = ?) ORDER BY id DESC LIMIT 30", [req.user!.id, req.user!.tenant_id]);
  res.json({ rows });
}));
