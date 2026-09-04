import { Router } from "express";
import { z } from "zod";
import { q, q1, run, now } from "../db/connection.js";
import { audit } from "../core/audit.js";
import { asyncH, authRequired, clientIp, requirePerm, type AuthedRequest } from "../middleware.js";
import { buildApplicationContext, capacityMetrics } from "../core/ctx.js";
import { evaluateRuleSet, type BreRule } from "../core/bre.js";
import { buildSchedule, computeApr, computeEmi, computeDpd, inrLakh } from "../core/finance.js";
import { CATALOG_BY_CODE, parseRowConfig, buildIntegrationView, panVerify, DigitapError, toDigitapDob, maskPan, digitapConfig } from "../adapters/index.js";
import { saveConsentRecord, logProviderRequest, saveVerificationResult } from "../db/supabase.js";

export const losRouter = Router();
losRouter.use(authRequired);

/* deterministic pseudo-random for mock data generation */
function prand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAGE_ORDER = ["application", "kyc", "documents", "credit", "banking", "gst", "bre", "underwriting", "approval", "sanction", "kfs", "agreement", "esign", "disbursement"];

/* ---------- APPLICATIONS ---------- */

losRouter.get("/applications", requirePerm("applications.view"), asyncH(async (req: AuthedRequest, res) => {
  const { q: query, stage, status, product_id, page = 1, limit = 25, sort = "created_at", dir = "desc" } = req.query as Record<string, string>;
  const where = ["a.tenant_id = ?"];
  const params: unknown[] = [req.user!.tenant_id];
  if (query) { where.push("(a.application_no LIKE ? OR c.name LIKE ? OR c.mobile LIKE ?)"); params.push(`%${query}%`, `%${query}%`, `%${query}%`); }
  if (stage) { where.push("a.stage = ?"); params.push(stage); }
  if (status) { where.push("a.status = ?"); params.push(status); }
  if (product_id) { where.push("a.product_id = ?"); params.push(Number(product_id)); }
  const total = (await q1<{ n: number }>(`SELECT COUNT(*) AS n FROM applications a JOIN customers c ON c.id = a.customer_id WHERE ${where.join(" AND ")}`, params))!.n;
  const rows = await q<Record<string, any>>(
    `SELECT a.id, a.application_no, a.requested_amount, a.approved_amount, a.tenure, a.status, a.stage,
            a.risk_grade, a.bre_result, a.decision, a.created_at, a.source,
            c.name AS customer_name, c.mobile, c.credit_score, c.city,
            p.name AS product_name, p.category AS product_category,
            u.name AS credit_officer_name,
            (SELECT COUNT(*) FROM documents d WHERE d.application_id = a.id AND d.status = 'verified') AS docs_verified,
            CASE WHEN a.stage IN ('credit','banking','gst','bre','underwriting','approval') THEN 1 ELSE 0 END AS needs_action
     FROM applications a
     JOIN customers c ON c.id = a.customer_id
     JOIN products p ON p.id = a.product_id
     LEFT JOIN users u ON u.id = a.credit_officer_id
     WHERE ${where.join(" AND ")}
     ORDER BY a.${["created_at", "requested_amount", "customer_name"].includes(sort) ? sort : "created_at"} ${dir === "asc" ? "ASC" : "DESC"}
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), (Math.max(1, Number(page)) - 1) * Number(limit)]
  );
  const stages = await q("SELECT code, name, seq, sla_hours FROM workflow_stages WHERE tenant_id = ? AND active = 1 ORDER BY seq", [req.user!.tenant_id]);
  res.json({ rows, total, page: Number(page), limit: Number(limit), stages });
}));

const appSchema = z.object({
  customer_id: z.number(),
  product_id: z.number(),
  lead_id: z.number().nullable().optional(),
  branch_id: z.number().nullable().optional(),
  dsa_id: z.number().nullable().optional(),
  sales_officer_id: z.number().nullable().optional(),
  requested_amount: z.number(),
  tenure: z.number(),
  purpose: z.string().optional(),
  co_applicant_name: z.string().optional()
});

losRouter.post("/applications", requirePerm("applications.create"), asyncH(async (req: AuthedRequest, res) => {
  const body = appSchema.parse(req.body);
  const product = await q1("SELECT * FROM products WHERE id = ? AND tenant_id = ?", [body.product_id, req.user!.tenant_id]);
  if (!product) { res.status(400).json({ error: "Invalid product" }); return; }
  if (body.requested_amount < product.min_amount || body.requested_amount > product.max_amount) {
    res.status(400).json({ error: `Amount must be between ${inrLakh(product.min_amount)} and ${inrLakh(product.max_amount)} for ${product.name}` });
    return;
  }
  if (body.tenure < product.min_tenure || body.tenure > product.max_tenure) {
    res.status(400).json({ error: `Tenure must be between ${product.min_tenure} and ${product.max_tenure} months` });
    return;
  }
  const appNo = "APP" + new Date().getFullYear().toString().slice(2) + String(Math.floor(100000 + Math.random() * 899999));
  const id = (await run(
    `INSERT INTO applications (tenant_id, application_no, lead_id, customer_id, product_id, branch_id, dsa_id, sales_officer_id, source, requested_amount, tenure, purpose, co_applicant_name, status, stage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_progress', 'application')`,
    [req.user!.tenant_id, appNo, body.lead_id ?? null, body.customer_id, body.product_id,
     body.branch_id ?? req.user!.branch_id ?? null, body.dsa_id ?? null, body.sales_officer_id ?? null,
     "manual", body.requested_amount, body.tenure, body.purpose ?? null, body.co_applicant_name ?? null]
  )).lastId;
  await run("UPDATE applications SET stage = 'kyc' WHERE id = ?", [id]);
  await run("INSERT INTO application_stages (application_id, stage, entered_at, status) VALUES (?, 'application', datetime('now'), 'completed')", [id]);
  await run("INSERT INTO application_stages (application_id, stage, entered_at, status) VALUES (?, 'kyc', datetime('now'), 'in_progress')", [id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "application.create", entityType: "application", entityId: id, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM applications WHERE id = ?", [id]));
}));

/** Full workspace payload for one application. */
losRouter.get("/applications/:id", requirePerm("applications.view"), asyncH(async (req: AuthedRequest, res) => {
  const app = await q1<Record<string, any>>(
    `SELECT a.*, c.name AS customer_name, c.mobile, c.email, c.pan, c.dob, c.employment_type, c.business_name,
            c.monthly_income, c.annual_income, c.business_turnover, c.credit_score, c.risk_class AS customer_risk, c.city, c.state,
            p.name AS product_name, p.category, p.interest_rate, p.interest_type, p.processing_fee_pct, p.processing_fee_gst_pct,
            p.penal_rate_pct, p.late_fee_amount, p.grace_days, p.foreclosure_charge_pct, p.allocation_order,
            u.name AS credit_officer_name
     FROM applications a
     JOIN customers c ON c.id = a.customer_id
     JOIN products p ON p.id = a.product_id
     LEFT JOIN users u ON u.id = a.credit_officer_id
     WHERE a.id = ? AND a.tenant_id = ?`,
    [req.params.id, req.user!.tenant_id]
  );
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const stages = await q("SELECT code, name, seq, sla_hours, required_documents FROM workflow_stages WHERE tenant_id = ? AND active = 1 ORDER BY seq", [req.user!.tenant_id]);
  const stageHistory = await q("SELECT * FROM application_stages WHERE application_id = ? ORDER BY id", [app.id]);
  const documents = await q("SELECT * FROM documents WHERE application_id = ? ORDER BY id", [app.id]);
  const bureau = await q1("SELECT * FROM bureau_reports WHERE customer_id = ? ORDER BY id DESC LIMIT 1", [app.customer_id]);
  const bank = await q1("SELECT * FROM bank_analyses WHERE application_id = ? ORDER BY id DESC LIMIT 1", [app.id]);
  const gst = await q1("SELECT * FROM gst_profiles WHERE customer_id = ? ORDER BY id DESC LIMIT 1", [app.customer_id]);
  const evaluations = await q("SELECT * FROM bre_evaluations WHERE application_id = ? ORDER BY id DESC LIMIT 20", [app.id]);
  const approvals = await q("SELECT * FROM approvals WHERE entity_type = 'application' AND entity_id = ? ORDER BY id", [app.id]);
  const sanction = await q1("SELECT * FROM sanctions WHERE application_id = ? ORDER BY id DESC LIMIT 1", [app.id]);
  const kfs = await q1("SELECT * FROM kfs_documents WHERE application_id = ? ORDER BY version DESC LIMIT 1", [app.id]);
  const agreements = await q("SELECT * FROM agreements WHERE application_id = ? ORDER BY id DESC LIMIT 3", [app.id]);
  const existingLoans = await q("SELECT id, loan_no, principal, outstanding, status FROM loans WHERE application_id = ?", [app.id]);
  const ctx = await buildApplicationContext(app.id);
  const cap = capacityMetrics(ctx);
  const activeRules = await q("SELECT * FROM bre_rules WHERE tenant_id = ? AND status = 'active' ORDER BY priority", [req.user!.tenant_id]);
  const panInt = await q1<Record<string, any>>("SELECT * FROM integrations WHERE tenant_id = ? AND code = 'pan_verify'", [req.user!.tenant_id]);
  const hub = { panVerify: panInt ? buildIntegrationView(panInt) : null };
  res.json({ app, stages, stageHistory, documents, bureau, bank, gst, evaluations, approvals, sanction, kfs, agreements, existingLoans, ctx: { ...ctx, capacity: cap }, rules: activeRules, hub });
}));

losRouter.patch("/applications/:id", requirePerm("applications.edit"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ requested_amount: z.number().optional(), tenure: z.number().optional(), purpose: z.string().optional(), credit_officer_id: z.number().nullable().optional() }).parse(req.body);
  const before = await q1("SELECT * FROM applications WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!before) { res.status(404).json({ error: "Application not found" }); return; }
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    sets.push(`${k} = ?`);
    params.push(v === undefined ? null : v);
  }
  params.push(req.params.id);
  await run(`UPDATE applications SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`, params);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "application.update", entityType: "application", entityId: before.id, before, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM applications WHERE id = ?", [before.id]));
}));

/* ---------- WORKFLOW ADVANCE ---------- */

losRouter.post("/applications/:id/advance", requirePerm("applications.advance"), asyncH(async (req: AuthedRequest, res) => {
  const app = await q1<Record<string, any>>("SELECT * FROM applications WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const idx = STAGE_ORDER.indexOf(app.stage);
  if (idx < 0 || idx >= STAGE_ORDER.length - 1) {
    res.status(400).json({ error: "Application is at the final stage" });
    return;
  }
  const nextStage = STAGE_ORDER[idx + 1];
  const stageDef = await q1<Record<string, any>>("SELECT * FROM workflow_stages WHERE code = ? AND tenant_id = ? AND active = 1", [app.stage, req.user!.tenant_id]);

  // Entry-gate checks for the current stage (configurable required docs/fields)
  const missing: string[] = [];
  if (stageDef) {
    const reqDocs: string[] = JSON.parse(stageDef.required_documents || "[]");
    for (const cat of reqDocs) {
      const has = await q1("SELECT id FROM documents WHERE application_id = ? AND category = ? AND status = 'verified'", [app.id, cat]);
      if (!has) missing.push(`Verified document: ${cat.replace(/_/g, " ")}`);
    }
    const reqFields: string[] = JSON.parse(stageDef.required_fields || "[]");
    for (const f of reqFields) {
      if (!app[f]) missing.push(`Field: ${f.replace(/_/g, " ")}`);
    }
  }

  await run("UPDATE application_stages SET exited_at = datetime('now'), status = 'completed' WHERE application_id = ? AND stage = ?", [app.id, app.stage]);
  const existing = await q1("SELECT id FROM application_stages WHERE application_id = ? AND stage = ?", [app.id, nextStage]);
  if (existing) await run("UPDATE application_stages SET entered_at = datetime('now'), status = 'in_progress' WHERE id = ?", [existing.id]);
  else await run("INSERT INTO application_stages (application_id, stage, entered_at, status) VALUES (?, ?, datetime('now'), 'in_progress')", [app.id, nextStage]);
  await run("UPDATE applications SET stage = ?, updated_at = datetime('now') WHERE id = ?", [nextStage, app.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: `application.advance.${nextStage}`, entityType: "application", entityId: app.id, after: { from: app.stage, to: nextStage, missing }, ip: clientIp(req) });
  res.json({ stage: nextStage, missing });
}));

/* ---------- DOCUMENTS ---------- */

losRouter.post("/applications/:id/documents", requirePerm("applications.edit"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ category: z.string(), name: z.string().optional(), ocr_confidence: z.number().optional() }).parse(req.body);
  const app = await q1<Record<string, any>>("SELECT * FROM applications WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const confidence = body.ocr_confidence ?? Math.round((70 + Math.random() * 29) * 10) / 10;
  const id = (await run(
    "INSERT INTO documents (tenant_id, customer_id, application_id, category, name, file_path, status, ocr_confidence, ocr_data) VALUES (?, ?, ?, ?, ?, ?, 'uploaded', ?, ?)",
    [req.user!.tenant_id, app.customer_id, app.id, body.category, body.name ?? body.category, `docs/${app.application_no}/${body.category}.pdf`, confidence, JSON.stringify({ provider: "MOCK-OCR", model: "nexus-doc-intel-v1" })]
  )).lastId;
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "document.upload", entityType: "document", entityId: id, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM documents WHERE id = ?", [id]));
}));

losRouter.post("/documents/:id/verify", requirePerm("applications.edit"), asyncH(async (req: AuthedRequest, res) => {
  const doc = await q1("SELECT * FROM documents WHERE id = ?", [req.params.id]);
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  const before = { ...doc };
  await run("UPDATE documents SET status = 'verified', verified_by = ?, verified_at = datetime('now') WHERE id = ?", [req.user!.id, doc.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "document.verify", entityType: "document", entityId: doc.id, before, after: { status: "verified" }, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM documents WHERE id = ?", [doc.id]));
}));

losRouter.post("/documents/:id/reject", requirePerm("applications.edit"), asyncH(async (req: AuthedRequest, res) => {
  await run("UPDATE documents SET status = 'rejected', verified_by = ?, verified_at = datetime('now') WHERE id = ?", [req.user!.id, req.params.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "document.reject", entityType: "document", entityId: req.params.id, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM documents WHERE id = ?", [req.params.id]));
}));

/* ---------- CREDIT DATA (ADAPTER-DRIVEN: live providers once Digitap enables
 * the bureau/BSA/GST suites; today only the labelled sandbox drivers exist) --- */

losRouter.post("/applications/:id/credit", requirePerm("credit.fetch"), asyncH(async (req: AuthedRequest, res) => {
  const app = await q1<Record<string, any>>("SELECT * FROM applications WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const cust = await q1<Record<string, any>>("SELECT * FROM customers WHERE id = ?", [app.customer_id]);
  if (!cust) { res.status(404).json({ error: "Customer not found" }); return; }

  // Registry gate: if an admin marked a bureau/BSA/GST adapter LIVE, never
  // fabricate its data — report the honest enablement state instead.
  const liveCodes: string[] = [];
  const intRows = await q<Record<string, any>>("SELECT code, config FROM integrations WHERE tenant_id = ? AND code IN ('cibil','experian','equifax','crif','bank_statement','gst')", [req.user!.tenant_id]);
  for (const r of intRows) if (parseRowConfig(r).mode === "live") liveCodes.push(r.code);
  if (liveCodes.length) {
    const blocked = liveCodes.map((c) => CATALOG_BY_CODE.get(c)?.name ?? c).join(", ");
    res.status(422).json({
      ok: false, sandbox: false, liveBlocked: liveCodes,
      error: `${blocked} ${liveCodes.length > 1 ? "are" : "is"} set to live but Digitap has not enabled the suite yet — no data was fabricated. Run the hub Test or switch back to Sandbox.`
    });
    return;
  }
  const rnd = prand(cust.id * 7919 + app.id * 104729);

  // Bureau (Mock-CIBIL adapter)
  let score = cust.credit_score;
  if (!score) {
    score = Math.round(560 + rnd() * 300);
    await run("UPDATE customers SET credit_score = ? WHERE id = ?", [score, cust.id]);
  }
  const activeAccounts = Math.round(2 + rnd() * 8);
  const closedAccounts = Math.round(1 + rnd() * 6);
  const totalOutstanding = Math.round((20000 + rnd() * 400000) / 1000) * 1000;
  const utilization = Math.round(rnd() * 80 * 10) / 10;
  const dpdMax = score > 750 ? 0 : score > 650 ? Math.round(rnd() * 30) : Math.round(rnd() * 90);
  const overdueAccounts = dpdMax > 0 ? 1 + Math.round(rnd() * 2) : 0;
  const enquiries = Math.round(rnd() * 6);
  const writeoffs = score < 680 && rnd() < 0.25 ? 1 : 0;
  const settlements = score < 700 && rnd() < 0.3 ? 1 : 0;
  const scoreBand = score >= 750 ? "Excellent (750-900)" : score >= 700 ? "Good (700-749)" : score >= 650 ? "Fair (650-699)" : score >= 550 ? "Below Average (550-649)" : "Poor (<550)";
  const history: Record<string, number> = {};
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (let i = 0; i < 12; i++) history[months[i]] = Math.min(30, dpdMax);
  await run(
    `INSERT INTO bureau_reports (tenant_id, customer_id, provider, score, score_band, total_accounts, active_accounts, closed_accounts,
       overdue_accounts, total_outstanding, credit_utilization, enquiries_6m, writeoffs, settlements, dpd_max, repayment_history, data, is_mock)
     VALUES (?, ?, 'MOCK-CIBIL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [req.user!.tenant_id, cust.id, score, scoreBand, activeAccounts + closedAccounts, activeAccounts, closedAccounts,
     overdueAccounts, totalOutstanding, utilization, enquiries, writeoffs, settlements, dpdMax, JSON.stringify(history), JSON.stringify({ adapter: "MockCreditAdapter", warning: "SANDBOX DATA — not a real bureau fetch" })]
  );

  // Bank analysis (Mock bank-statement parser)
  const income = cust.monthly_income || Math.round((cust.business_turnover || 300000 + rnd() * 2000000) / 12);
  const expense = Math.round(income * (0.5 + rnd() * 0.25));
  const emiObligations = Math.round((5000 + rnd() * 30000) / 500) * 500;
  const bounces = rnd() < 0.25 ? 1 + Math.round(rnd() * 3) : 0;
  const avgBalance = Math.round((15000 + rnd() * 150000) / 1000) * 1000;
  const cashDeposits = Math.round(rnd() * income * 0.4 / 1000) * 1000;
  const turnover = Math.round(income * 12 * (0.9 + rnd() * 0.4));
  const bankRisk = bounces > 2 ? "high" : bounces > 0 ? "medium" : "low";
  await run(
    `INSERT INTO bank_analyses (tenant_id, customer_id, application_id, provider, monthly_income, monthly_expense, avg_balance,
       emi_obligations, banking_surplus, bounce_count, cash_deposits, turnover, months_analyzed, risk, data)
     VALUES (?, ?, ?, 'MOCK-BANK', ?, ?, ?, ?, ?, ?, ?, ?, 6, ?, ?)`,
    [req.user!.tenant_id, cust.id, app.id, income, expense, avgBalance, emiObligations, income - expense - emiObligations,
     bounces, cashDeposits, turnover, bankRisk, JSON.stringify({ adapter: "MockBankAdapter", categories: { salary: Math.round(income * 0.8), business: Math.round(income * 0.2) } })]
  );

  // GST profile (Mock adapter)
  const gstin = cust.pan ? cust.pan.slice(0, 5) + "F" + String(1000 + Math.round(rnd() * 8999)) + "Z" + String(1 + Math.round(rnd() * 5)) : null;
  const gstTurnover = cust.business_turnover || Math.round(turnover * (0.7 + rnd() * 0.3));
  const declaredVsBanking = Math.round((gstTurnover / Math.max(1, turnover)) * 100);
  await run(
    `INSERT INTO gst_profiles (tenant_id, customer_id, gstin, turnover, filing_status, filing_frequency, tax_liability, declared_vs_banking_pct, risk, data, is_mock)
     VALUES (?, ?, ?, ?, ?, 'Monthly', ?, ?, ?, ?, 1)`,
    [req.user!.tenant_id, cust.id, gstin, gstTurnover, rnd() < 0.85 ? "filed" : "pending", Math.round(gstTurnover * 0.12 / 12),
     declaredVsBanking, declaredVsBanking < 60 ? "high" : declaredVsBanking < 85 ? "medium" : "low", JSON.stringify({ adapter: "MockGSTAdapter" })]
  );

  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "credit.fetch_mock", entityType: "application", entityId: app.id, after: { score, adapter: "SANDBOX" }, ip: clientIp(req) });
  res.json({ ok: true, score, sandbox: true });
}));

/* ---------- FRAUD SCORE ---------- */

async function fraudScore(cust: Record<string, any>, app: Record<string, any>) {
  const flags: string[] = [];
  let score = 0;
  if (cust.pan) {
    const dupPan = await q1("SELECT id FROM customers WHERE pan = ? AND id != ? AND tenant_id = ?", [cust.pan, cust.id, cust.tenant_id]);
    if (dupPan) { score += 35; flags.push("Duplicate PAN across customers"); }
  }
  if (cust.mobile) {
    const dupMobile = await q1("SELECT id FROM customers WHERE mobile = ? AND id != ? AND tenant_id = ?", [cust.mobile, cust.id, cust.tenant_id]);
    if (dupMobile) { score += 25; flags.push("Duplicate mobile across customers"); }
  }
  const bank = await q1("SELECT * FROM bank_analyses WHERE application_id = ? ORDER BY id DESC LIMIT 1", [app.id]);
  if (bank) {
    const declared = cust.monthly_income || 0;
    if (declared > 0 && Math.abs(bank.monthly_income - declared) / declared > 0.4) { score += 20; flags.push("Income mismatch: declared vs bank statement"); }
    if (bank.bounce_count >= 3) { score += 15; flags.push("High cheque bounce count"); }
  }
  const velocity = await q1<{ n: number }>("SELECT COUNT(*) AS n FROM applications WHERE customer_id = ? AND created_at >= datetime('now', '-90 days')", [cust.id]);
  if (velocity && velocity.n >= 3) { score += 10; flags.push("Multiple applications in 90 days"); }
  const riskStates = ["Jammu & Kashmir", "Manipur"];
  if (riskStates.includes(cust.state || "")) { score += 15; flags.push("High-risk geography"); }
  return { score: Math.min(95, score), flags };
}

losRouter.post("/applications/:id/fraud", requirePerm("credit.fetch"), asyncH(async (req: AuthedRequest, res) => {
  const app = await q1<Record<string, any>>("SELECT * FROM applications WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const cust = await q1<Record<string, any>>("SELECT * FROM customers WHERE id = ?", [app.customer_id]);
  const { score, flags } = await fraudScore(cust!, app);
  await run("UPDATE applications SET fraud_score = ? WHERE id = ?", [score, app.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "credit.fraud_score", entityType: "application", entityId: app.id, after: { score, flags }, ip: clientIp(req) });
  res.json({ score, flags, band: score >= 60 ? "HIGH" : score >= 35 ? "MEDIUM" : score >= 15 ? "LOW" : "NEGLIGIBLE" });
}));

/* ---------- BRE EVALUATION ---------- */

losRouter.post("/applications/:id/bre", requirePerm("bre.view"), asyncH(async (req: AuthedRequest, res) => {
  const app = await q1<Record<string, any>>("SELECT * FROM applications WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const rules = await q<Record<string, any>>("SELECT * FROM bre_rules WHERE tenant_id = ? AND status = 'active' ORDER BY priority", [req.user!.tenant_id]);
  const ctx = await buildApplicationContext(app.id);
  const breRules: BreRule[] = rules.map((r) => ({
    id: r.id, code: r.code, name: r.name, category: r.category, priority: r.priority,
    conditions: JSON.parse(r.conditions), action: JSON.parse(r.action)
  }));
  const result = evaluateRuleSet(breRules, ctx);
  const detail = { ctx, result };
  await run(
    "UPDATE applications SET bre_result = ?, bre_detail = ?, risk_grade = ? WHERE id = ?",
    [result.eligible ? "eligible" : "rejected", JSON.stringify(detail), result.riskGrade, app.id]
  );
  for (const rule of breRules) {
    const single = evaluateRuleSet([rule], ctx);
    await run("INSERT INTO bre_evaluations (application_id, rule_id, rule_version, passed, result) VALUES (?, ?, 1, ?, ?)",
      [app.id, rule.id, single.eligible ? 1 : 0, JSON.stringify(single)]);
  }
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "bre.evaluate", entityType: "application", entityId: app.id, after: { eligible: result.eligible, riskGrade: result.riskGrade, reasons: result.reasons }, ip: clientIp(req) });
  res.json({ ...result, ctx });
}));

/* ---------- UNDERWRITING DECISION ---------- */

losRouter.post("/applications/:id/decide", requirePerm("underwriting.decide"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ decision: z.enum(["approve", "reject", "send_back", "approve_with_conditions"]), note: z.string().optional(), approved_amount: z.number().optional() }).parse(req.body);
  const app = await q1<Record<string, any>>("SELECT * FROM applications WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const before = { ...app };

  // Approval matrix from configurable policy (system_config), not hard-coded
  const matrixCfg = await q1<Record<string, any>>("SELECT value FROM system_config WHERE tenant_id = ? AND key = 'approval_matrix'", [req.user!.tenant_id]);
  const matrix: { upTo: number; role: string }[] = matrixCfg ? JSON.parse(matrixCfg.value) : [{ upTo: 500000, role: "sales_manager" }, { upTo: 2000000, role: "credit_manager" }, { upTo: 5000000, role: "credit_manager" }, { upTo: 999999999, role: "credit_manager" }];
  const amount = body.approved_amount ?? app.requested_amount ?? 0;
  const tier = matrix.find((m) => amount <= m.upTo) ?? matrix[matrix.length - 1];
  const isSuper = req.user!.role === "super_admin" || req.user!.role === "tenant_admin";

  if (!isSuper && req.user!.role !== tier.role) {
    res.status(403).json({ error: `This amount requires ${tier.role} approval (approval matrix tier up to ₹${tier.upTo.toLocaleString("en-IN")})` });
    return;
  }

  const approvedAmount = body.decision === "approve" || body.decision === "approve_with_conditions" ? (body.approved_amount ?? app.requested_amount) : null;
  const nextStatus = body.decision === "reject" ? "rejected" : body.decision === "send_back" ? "in_progress" : "approved";
  const nextStage = body.decision === "approve" || body.decision === "approve_with_conditions" ? "sanction" : app.stage;
  await run(
    `UPDATE applications SET decision = ?, decision_by = ?, decision_at = datetime('now'), decision_note = ?,
       approved_amount = ?, status = ?, stage = ?, updated_at = datetime('now') WHERE id = ?`,
    [body.decision, req.user!.id, body.note ?? null, approvedAmount, nextStatus, nextStage, app.id]
  );
  await run("INSERT INTO approvals (tenant_id, entity_type, entity_id, action, status, by_user, note) VALUES (?, 'application', ?, ?, 'approved', ?, ?)",
    [req.user!.tenant_id, app.id, body.decision, req.user!.id, body.note ?? null]);
  if (nextStage === "sanction") {
    await run("UPDATE application_stages SET exited_at = datetime('now'), status = 'completed' WHERE application_id = ? AND stage = 'approval'", [app.id]);
    await run("INSERT INTO application_stages (application_id, stage, entered_at, status) VALUES (?, 'sanction', datetime('now'), 'in_progress')", [app.id]);
  }
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: `application.${body.decision}`, entityType: "application", entityId: app.id, before, after: { ...body, tier: tier.role }, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM applications WHERE id = ?", [app.id]));
}));

/* ---------- SANCTION ---------- */

losRouter.post("/applications/:id/sanction", requirePerm("sanctions.issue"), asyncH(async (req: AuthedRequest, res) => {
  const app = await q1<Record<string, any>>("SELECT * FROM applications WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  if (app.decision !== "approve" && app.decision !== "approve_with_conditions") {
    res.status(400).json({ error: "Application must be approved before sanction" });
    return;
  }
  const product = await q1<Record<string, any>>("SELECT * FROM products WHERE id = ?", [app.product_id])!;
  const amount = app.approved_amount ?? app.requested_amount;
  const tenure = app.tenure ?? 36;
  const emi = computeEmi(amount, product.interest_rate, tenure, product.emi_frequency || "monthly");
  const fees = {
    processing_fee: Math.round(amount * product.processing_fee_pct / 100),
    processing_fee_gst: Math.round(amount * product.processing_fee_pct / 100 * product.processing_fee_gst_pct / 100),
    insurance: product.category === "vehicle" ? Math.round(amount * 0.015) : 0,
    legal_fee: 0, valuation_fee: 0, documentation_fee: 0
  };
  const sanctionNo = "SNC" + new Date().getFullYear().toString().slice(2) + String(Math.floor(10000 + Math.random() * 89999));
  const existing = await q1("SELECT id FROM sanctions WHERE application_id = ?", [app.id]);
  if (existing) await run("UPDATE sanctions SET status = 'superseded' WHERE id = ?", [existing.id]);
  const id = (await run(
    `INSERT INTO sanctions (application_id, sanction_no, amount, tenure, rate, emi, fees_json, conditions, status, issued_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'issued', datetime('now'))`,
    [app.id, sanctionNo, amount, tenure, product.interest_rate, emi, JSON.stringify(fees),
     JSON.stringify(["Standard terms apply", "KYC documents verified", app.decision === "approve_with_conditions" ? "Conditions as per approval note" : "No special conditions"])]
  )).lastId;
  await run("UPDATE applications SET stage = 'kfs', updated_at = datetime('now') WHERE id = ?", [app.id]);
  await run("UPDATE application_stages SET exited_at = datetime('now'), status = 'completed' WHERE application_id = ? AND stage = 'sanction'", [app.id]);
  await run("INSERT INTO application_stages (application_id, stage, entered_at, status) VALUES (?, 'kfs', datetime('now'), 'in_progress')", [app.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "sanction.issue", entityType: "sanction", entityId: id, after: { sanctionNo, amount }, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM sanctions WHERE id = ?", [id]));
}));

/* ---------- KFS ---------- */

losRouter.post("/applications/:id/kfs", requirePerm("kfs.generate"), asyncH(async (req: AuthedRequest, res) => {
  const app = await q1<Record<string, any>>(
    "SELECT a.*, c.name AS customer_name FROM applications a JOIN customers c ON c.id = a.customer_id WHERE a.id = ? AND a.tenant_id = ?",
    [req.params.id, req.user!.tenant_id]
  );
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const product = await q1<Record<string, any>>("SELECT * FROM products WHERE id = ?", [app.product_id])!;
  const sanction = await q1<Record<string, any>>("SELECT * FROM sanctions WHERE application_id = ? ORDER BY id DESC LIMIT 1", [app.id]);
  const amount = sanction?.amount ?? app.approved_amount ?? app.requested_amount;
  const tenure = sanction?.tenure ?? app.tenure ?? 36;
  const rate = sanction?.rate ?? product.interest_rate;
  const emi = sanction?.emi ?? computeEmi(amount, rate, tenure, product.emi_frequency || "monthly");
  const schedule = buildSchedule({
    principal: amount, annualRatePct: rate, tenure, firstDueDate: nextMonth(), interestType: product.interest_type || "reducing", frequency: product.emi_frequency || "monthly", lateFeeAmount: product.late_fee_amount || 0
  });
  const fees: Record<string, number> = sanction ? JSON.parse(sanction.fees_json) : {
    processing_fee: Math.round(amount * product.processing_fee_pct / 100),
    processing_fee_gst: Math.round(amount * product.processing_fee_pct / 100 * product.processing_fee_gst_pct / 100)
  };
  const totalFees = Object.values(fees).reduce((a, b) => a + Number(b), 0);
  const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
  const totalRepayment = amount + totalInterest + totalFees;
  const apr = computeApr(amount, rate, tenure, totalFees, emi);
  const npaPolicy = await q1<Record<string, any>>("SELECT value FROM system_config WHERE tenant_id = ? AND key = 'npa_policy'", [req.user!.tenant_id]);

  const content = {
    kfs_id: "KFS-" + app.application_no + "-v1",
    borrower: app.customer_name, loan_amount: amount, tenure_months: tenure,
    annual_interest_rate: rate, interest_type: product.interest_type,
    emi: emi, repayment_frequency: product.emi_frequency || "monthly",
    first_repayment_date: nextMonth(), total_interest: totalInterest,
    total_fees: totalFees, fee_breakup: fees, total_repayment: totalRepayment,
    apr: apr, apr_disclosure: `Annual Percentage Rate (including fees): ${apr}%`,
    penal_rate: product.penal_rate_pct, late_fee: product.late_fee_amount,
    grace_days: product.grace_days, prepayment_allowed: !!product.prepayment_allowed,
    foreclosure_charge_pct: product.foreclosure_charge_pct,
    schedule_preview: schedule.slice(0, 12).map((r) => ({ seq: r.seq, due: r.dueDate, emi: r.total, principal: r.principal, interest: r.interest, closing: r.closingBalance })),
    npa_policy: npaPolicy ? JSON.parse(npaPolicy.value) : { npa_days: 90 },
    generated_at: now(), compliance_status: "compliant", blockers: [] as string[], notes: ["Fees and APR disclosed", "Amortization schedule provided", "Penal charges disclosed"]
  };

  // Compliance validation — flag blockers rather than silently passing
  const blockers: string[] = [];
  if (!content.borrower) blockers.push("Borrower name missing");
  if (!content.loan_amount) blockers.push("Loan amount missing");
  if (!content.annual_interest_rate) blockers.push("Interest rate missing");
  if (!content.apr) blockers.push("APR not computable");
  if (!content.schedule_preview?.length) blockers.push("Repayment schedule missing");
  content.compliance_status = blockers.length ? "blocked" : "compliant";
  content.blockers = blockers;

  const lastVersion = await q1<{ v: number }>("SELECT COALESCE(MAX(version), 0) AS v FROM kfs_documents WHERE application_id = ?", [app.id]);
  const version = (lastVersion?.v ?? 0) + 1;
  const id = (await run(
    "INSERT INTO kfs_documents (application_id, version, content, status, generated_at) VALUES (?, ?, ?, 'generated', datetime('now'))",
    [app.id, version, JSON.stringify(content)]
  )).lastId;
  await run("UPDATE applications SET stage = 'agreement', updated_at = datetime('now') WHERE id = ?", [app.id]);
  await run("UPDATE application_stages SET exited_at = datetime('now'), status = 'completed' WHERE application_id = ? AND stage = 'kfs'", [app.id]);
  await run("INSERT INTO application_stages (application_id, stage, entered_at, status) VALUES (?, 'agreement', datetime('now'), 'in_progress')", [app.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "kfs.generate", entityType: "kfs", entityId: id, after: { version, apr, blockers }, ip: clientIp(req) });
  res.json({ kfs: await q1("SELECT * FROM kfs_documents WHERE id = ?", [id]), content, blockers });
}));

/* ---------- AGREEMENT + E-SIGN (SANDBOX) ---------- */

losRouter.post("/applications/:id/agreement", requirePerm("agreements.*"), asyncH(async (req: AuthedRequest, res) => {
  const app = await q1<Record<string, any>>(
    "SELECT a.*, c.name AS customer_name FROM applications a JOIN customers c ON c.id = a.customer_id WHERE a.id = ? AND a.tenant_id = ?",
    [req.params.id, req.user!.tenant_id]
  );
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const sanction = await q1<Record<string, any>>("SELECT * FROM sanctions WHERE application_id = ? ORDER BY id DESC LIMIT 1", [app.id]);
  const kfs = await q1<Record<string, any>>("SELECT * FROM kfs_documents WHERE application_id = ? ORDER BY version DESC LIMIT 1", [app.id]);
  const existing = await q1("SELECT id FROM agreements WHERE application_id = ? AND status = 'signed'", [app.id]);
  if (existing) { res.status(400).json({ error: "Agreement already signed" }); return; }
  const amount = sanction?.amount ?? app.approved_amount ?? app.requested_amount;
  const hash = "SHA256:" + Buffer.from(`${app.application_no}:${amount}:${kfs?.version ?? 1}:SANDBOX`).toString("hex").slice(0, 32);
  const id = (await run(
    `INSERT INTO agreements (application_id, template, status, signed_at, signer_name, hash, provider)
     VALUES (?, 'loan_agreement_v1', 'signed', datetime('now'), ?, ?, 'SANDBOX-ESIGN')`,
    [app.id, app.customer_name, hash]
  )).lastId;
  await run("UPDATE applications SET stage = 'disbursement', updated_at = datetime('now') WHERE id = ?", [app.id]);
  await run("UPDATE application_stages SET exited_at = datetime('now'), status = 'completed' WHERE application_id = ? AND stage = 'agreement'", [app.id]);
  await run("INSERT INTO application_stages (application_id, stage, entered_at, status) VALUES (?, 'disbursement', datetime('now'), 'in_progress')", [app.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "agreement.sign_sandbox", entityType: "agreement", entityId: id, after: { hash, provider: "SANDBOX-ESIGN" }, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM agreements WHERE id = ?", [id]));
}));

function nextMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  d.setDate(5);
  return d.toISOString().slice(0, 10);
}

/* ---------- DISBURSEMENT (creates the loan) ---------- */

losRouter.post("/applications/:id/disburse", requirePerm("disbursements.*"), asyncH(async (req: AuthedRequest, res) => {
  const app = await q1<Record<string, any>>(
    "SELECT a.*, c.name AS customer_name FROM applications a JOIN customers c ON c.id = a.customer_id WHERE a.id = ? AND a.tenant_id = ?",
    [req.params.id, req.user!.tenant_id]
  );
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  if (app.decision !== "approve" && app.decision !== "approve_with_conditions") {
    res.status(400).json({ error: "Application not approved" });
    return;
  }
  const existing = await q1("SELECT id FROM loans WHERE application_id = ?", [app.id]);
  if (existing) { res.status(400).json({ error: "Loan already disbursed for this application" }); return; }
  const product = await q1<Record<string, any>>("SELECT * FROM products WHERE id = ?", [app.product_id])!;
  const amount = app.approved_amount ?? app.requested_amount;
  const tenure = app.tenure ?? 36;
  const rate = product.interest_rate;
  const emi = computeEmi(amount, rate, tenure, product.emi_frequency || "monthly");
  const loanNo = "LN" + new Date().getFullYear().toString().slice(2) + String(Math.floor(100000 + Math.random() * 899999));
  const firstEmi = nextMonth();

  const loanId = (await run(
    `INSERT INTO loans (tenant_id, loan_no, application_id, customer_id, product_id, branch_id, principal, rate, tenure, emi, first_emi_at, status, outstanding, risk_grade)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [req.user!.tenant_id, loanNo, app.id, app.customer_id, app.product_id, app.branch_id ?? null,
     amount, rate, tenure, emi, firstEmi, amount, app.risk_grade ?? "standard"]
  )).lastId;

  const schedule = buildSchedule({
    principal: amount, annualRatePct: rate, tenure, firstDueDate: firstEmi,
    interestType: product.interest_type || "reducing", frequency: product.emi_frequency || "monthly", lateFeeAmount: product.late_fee_amount || 0
  });
  for (const row of schedule) {
    await run(
      "INSERT INTO installments (loan_id, seq, due_date, principal, interest, fees, total, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')",
      [loanId, row.seq, row.dueDate, row.principal, row.interest, row.fees, row.total]
    );
  }
  // Processing fee event
  const feeAmt = Math.round(amount * product.processing_fee_pct / 100);
  if (feeAmt > 0) {
    await run("UPDATE loans SET fees_due = fees_due + ? WHERE id = ?", [feeAmt, loanId]);
    await run("INSERT INTO charge_events (tenant_id, loan_id, kind, amount, reason) VALUES (?, ?, 'processing_fee', ?, 'Processing fee as per KFS')", [req.user!.tenant_id, loanId, feeAmt]);
  }
  await run("UPDATE applications SET status = 'approved', stage = 'disbursement', updated_at = datetime('now') WHERE id = ?", [app.id]);
  await run("UPDATE application_stages SET exited_at = datetime('now'), status = 'completed' WHERE application_id = ? AND stage = 'disbursement'", [app.id]);
  await run("INSERT INTO notifications (tenant_id, title, body) VALUES (?, 'Loan disbursed', ?)", [req.user!.tenant_id, `${loanNo} of ₹${amount.toLocaleString("en-IN")} disbursed to ${app.customer_name}`]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "loan.disburse", entityType: "loan", entityId: loanId, after: { loanNo, amount, tenure, rate, emi }, ip: clientIp(req) });
  res.json({ loanId, loanNo, emi, scheduleLength: schedule.length });
}));

/* ---------- KYC ---------- */

losRouter.post("/applications/:id/kyc", requirePerm("kyc.*"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ type: z.string(), provider: z.string().optional() }).parse(req.body);
  const app = await q1<Record<string, any>>("SELECT * FROM applications WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const cust = await q1<Record<string, any>>("SELECT * FROM customers WHERE id = ?", [app.customer_id]);
  if (!cust) { res.status(404).json({ error: "Customer not found" }); return; }

  // Consent is a precondition for every provider-backed KYC call (RBI DL-03 /
  // KYC-01). Recorded in the CRM consent ledger and mirrored to Supabase.
  const consentId = (await run("INSERT INTO consents (tenant_id, customer_id, type, purpose, channel, status) VALUES (?, ?, 'kyc', ?, 'portal', 'active')",
    [req.user!.tenant_id, app.customer_id, `KYC verification via ${body.type.toUpperCase()}`])).lastId;
  await saveConsentRecord({ tenant_id: req.user!.tenant_id, customer_id: app.customer_id, purpose: `KYC verification via ${body.type.toUpperCase()}`, channel: "crm_portal", captured_by: req.user!.id, status: "active", payload: { application_id: app.id, consent_id: consentId } });

  const advanceKyc = async () => {
    await run("UPDATE customers SET kyc_status = 'verified' WHERE id = ?", [app.customer_id]);
    if (app.stage === "kyc") {
      await run("UPDATE applications SET stage = 'documents', updated_at = datetime('now') WHERE id = ?", [app.id]);
      await run("UPDATE application_stages SET exited_at = datetime('now'), status = 'completed' WHERE application_id = ? AND stage = 'kyc'", [app.id]);
      await run("INSERT INTO application_stages (application_id, stage, entered_at, status) VALUES (?, 'documents', datetime('now'), 'in_progress')", [app.id]);
    }
  };

  /* ---------- LIVE PAN VERIFICATION (Digitap PAN Basic V1/V2) ----------
   * Engaged only when the pan_verify integration row is set to live AND the
   * provider call succeeds. In every other state the labelled sandbox path
   * below runs — a mock result is never presented as a real verification. */
  if (body.type === "pan" && cust.pan) {
    const intRow = await q1<Record<string, any>>("SELECT * FROM integrations WHERE tenant_id = ? AND code = 'pan_verify'", [req.user!.tenant_id]);
    const rowCfg = intRow ? parseRowConfig(intRow) : null;
    // Live calls only fire after the hub Test proved connectivity (lastTestOk).
    const liveMode = !!intRow && rowCfg?.mode === "live" && rowCfg.lastTestOk === true && CATALOG_BY_CODE.get("pan_verify")?.driver === "digitap";
    if (liveMode) {
      const t0 = Date.now();
      const dob = toDigitapDob(cust.dob);
      const useV2 = !!dob && !!cust.name;
      const endpoint = useV2 ? "/validation/kyc/v2/pan_basic" : "/validation/kyc/v1/pan_basic";
      try {
        const { result, providerRef } = await panVerify({
          pan: cust.pan,
          name: cust.name,
          dob,
          v2: useV2,
          nameMatchMethod: "fuzzy"
        });
        const verified = result.panStatus === "Active" && result.nameMatch !== false && result.dobMatch !== false;
        const id = (await run(
          `INSERT INTO kyc_records (tenant_id, customer_id, type, status, provider, reference_id, result, consent_id, verified_by, verified_at, expires_at)
           VALUES (?, ?, 'pan', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+365 days'))`,
          [req.user!.tenant_id, app.customer_id, verified ? "verified" : "failed", `DIGITAP-PAN-BASIC-${digitapConfig().env.toUpperCase()}`,
           providerRef, JSON.stringify({ ...result, live: true, sandbox: false }), consentId, req.user!.id]
        )).lastId;
        if (verified) await advanceKyc();
        await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "kyc.pan_digitap", entityType: "kyc", entityId: id, after: { verified, provider: "DIGITAP-PAN-BASIC", requestId: providerRef, latencyMs: Date.now() - t0 }, ip: clientIp(req) });
        await logProviderRequest({ tenant_id: req.user!.tenant_id, customer_id: app.customer_id, application_id: app.id, user_id: req.user!.id, adapter: "pan_verify", endpoint, request_ref: providerRef, provider_request_id: providerRef, status: "success", latency_ms: Date.now() - t0 });
        await saveVerificationResult({ tenant_id: req.user!.tenant_id, customer_id: app.customer_id, application_id: app.id, adapter: "pan_verify", provider: "DIGITAP-PAN-BASIC", status: verified ? "verified" : "invalid", result: { ...result, live: true }, provider_request_id: providerRef });
        res.json({ ...(await q1("SELECT * FROM kyc_records WHERE id = ?", [id])), live: true, sandbox: false });
        return;
      } catch (e) {
        const latencyMs = Date.now() - t0;
        const httpStatus = e instanceof DigitapError ? e.httpStatus : 0;
        const reason =
          httpStatus === 400 ? "PAN format rejected by provider" :
          httpStatus === 401 ? "Provider authentication failed" :
          httpStatus === 0 ? "Provider unreachable or timed out — try again" :
          "PAN could not be verified (invalid/inactive PAN)";
        const errCode = e instanceof DigitapError && e.resultCode ? String(e.resultCode) : e instanceof DigitapError ? `HTTP${e.httpStatus}` : "NETWORK";
        const id = (await run(
          `INSERT INTO kyc_records (tenant_id, customer_id, type, status, provider, reference_id, result, consent_id, verified_by)
           VALUES (?, ?, 'pan', 'failed', 'DIGITAP-PAN-BASIC', ?, ?, ?, ?)`,
          [req.user!.tenant_id, app.customer_id, `${errCode}-${Date.now()}`, JSON.stringify({ live: true, sandbox: false, panMasked: maskPan(cust.pan), error: reason }), consentId, req.user!.id]
        )).lastId;
        await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "kyc.pan_digitap_failed", entityType: "kyc", entityId: id, after: { reason, errCode, latencyMs }, ip: clientIp(req) });
        await logProviderRequest({ tenant_id: req.user!.tenant_id, customer_id: app.customer_id, application_id: app.id, user_id: req.user!.id, adapter: "pan_verify", endpoint, status: "failed", error_code: errCode, latency_ms: latencyMs });
        res.status(422).json({ error: reason, provider: "DIGITAP-PAN-BASIC", code: errCode, kycRecordId: id });
        return;
      }
    }
  }

  /* ---------- SANDBOX PATH (unchanged demo behaviour, clearly labelled) ---------- */
  const rnd = prand(app.id * 31 + app.customer_id);
  const verified = rnd() > 0.12;
  const provider = body.provider ?? `MOCK-${body.type.toUpperCase()}`;
  const id = (await run(
    `INSERT INTO kyc_records (tenant_id, customer_id, type, status, provider, reference_id, result, consent_id, verified_by, verified_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+365 days'))`,
    [req.user!.tenant_id, app.customer_id, body.type, verified ? "verified" : "failed", provider,
     "REF" + String(Math.floor(100000 + rnd() * 899999)), JSON.stringify({ match: verified ? 0.94 + rnd() * 0.05 : 0.4, name_match: verified, live: false, sandbox: true }), consentId, req.user!.id]
  )).lastId;
  if (verified) await advanceKyc();
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: `kyc.${body.type}`, entityType: "kyc", entityId: id, after: { verified, provider, sandbox: true }, ip: clientIp(req) });
  await logProviderRequest({ tenant_id: req.user!.tenant_id, customer_id: app.customer_id, application_id: app.id, user_id: req.user!.id, adapter: body.type === "pan" ? "pan_verify" : body.type, endpoint: "mock", status: "sandbox" });
  res.json({ ...(await q1("SELECT * FROM kyc_records WHERE id = ?", [id])), live: false, sandbox: true });
}));

/* ---------- PRODUCTS ---------- */

losRouter.get("/products", authRequired, asyncH(async (req: AuthedRequest, res) => {
  const rows = await q("SELECT * FROM products WHERE tenant_id = ? ORDER BY id", [req.user!.tenant_id]);
  res.json(rows);
}));

export { prand };
