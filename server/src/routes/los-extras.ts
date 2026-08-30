import { Router } from "express";
import { z } from "zod";
import { q, q1, run, now } from "../db/connection.js";
import { audit } from "../core/audit.js";
import { asyncH, authRequired, clientIp, requirePerm, type AuthedRequest } from "../middleware.js";
import {
  eligibilityEngine, documentChecklist, slaStatus, slaSummary, duplicateScan,
  creditMemoContent, generateOffers, inrShort
} from "../core/engines.js";
import { computeEmi } from "../core/finance.js";

export const losExtrasRouter = Router();
losExtrasRouter.use(authRequired);

async function loadApp(req: AuthedRequest, id: string) {
  return await q1<Record<string, any>>(
    `SELECT a.*, c.name AS customer_name, c.mobile, c.email, c.pan, p.name AS product_name, p.category,
            p.interest_rate, p.processing_fee_pct, p.max_amount, p.min_amount, p.max_tenure, p.min_tenure
     FROM applications a
     JOIN customers c ON c.id = a.customer_id
     JOIN products p ON p.id = a.product_id
     WHERE a.id = ? AND a.tenant_id = ?`, [id, req.user!.tenant_id]);
}

/* ---------- SLA & escalation ---------- */

losExtrasRouter.get("/applications/sla", requirePerm("applications.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT a.id, a.application_no, a.stage, a.status, c.name AS customer_name,
            (SELECT entered_at FROM application_stages s WHERE s.application_id = a.id AND s.status = 'in_progress' ORDER BY s.id DESC LIMIT 1) AS entered_at
     FROM applications a JOIN customers c ON c.id = a.customer_id
     WHERE a.tenant_id = ? AND a.status = 'in_progress'
     ORDER BY a.updated_at DESC`, [req.user!.tenant_id]);
  const list = await Promise.all(rows.map(async (a) => ({ ...a, sla: await slaStatus(a) })));
  res.json({ rows: list, summary: await slaSummary(req.user!.tenant_id) });
}));

/* ---------- Eligibility / pre-screening ---------- */

losExtrasRouter.get("/applications/:id/eligibility", requirePerm("applications.view"), asyncH(async (req: AuthedRequest, res) => {
  const app = await loadApp(req, req.params.id);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  res.json(await eligibilityEngine(app.id));
}));

/* ---------- Duplicate / fraud detection ---------- */

losExtrasRouter.get("/applications/duplicates", requirePerm("applications.create"), asyncH(async (req: AuthedRequest, res) => {
  const { pan, mobile, email } = req.query as Record<string, string>;
  res.json(await duplicateScan(req.user!.tenant_id, { pan, mobile, email }));
}));

/* ---------- Document checklist ---------- */

losExtrasRouter.get("/applications/:id/checklist", requirePerm("applications.view"), asyncH(async (req: AuthedRequest, res) => {
  const app = await loadApp(req, req.params.id);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  res.json(await documentChecklist(app.id));
}));

/* ---------- Policy exceptions ---------- */

losExtrasRouter.get("/applications/:id/exceptions", requirePerm("applications.view"), asyncH(async (req: AuthedRequest, res) => {
  const app = await loadApp(req, req.params.id);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  res.json({ rows: await q("SELECT * FROM policy_exceptions WHERE application_id = ? ORDER BY id DESC", [app.id]) });
}));

losExtrasRouter.post("/applications/:id/exceptions", requirePerm("underwriting.*"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({
    rule_code: z.string().optional(), rule_name: z.string(), reason: z.string().min(5),
    impact: z.string().optional(), risk: z.string().optional(), approver_required: z.boolean().optional()
  }).parse(req.body);
  const app = await loadApp(req, req.params.id);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const id = (await run(
    "INSERT INTO policy_exceptions (tenant_id, application_id, rule_code, rule_name, reason, impact, risk, approver_required, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
    [req.user!.tenant_id, app.id, body.rule_code ?? null, body.rule_name, body.reason, body.impact ?? null, body.risk ?? "medium", body.approver_required ?? 1, req.user!.id]
  )).lastId;
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "policy_exception.create", entityType: "application", entityId: app.id, after: { ...body, exception_id: id }, ip: clientIp(req) });
  await run("INSERT INTO notifications (tenant_id, title, body) VALUES (?, 'Policy exception raised', ?)",
    [req.user!.tenant_id, `${app.application_no}: ${body.rule_name} — ${body.reason.slice(0, 60)}`]);
  res.json({ id });
}));

losExtrasRouter.post("/applications/exceptions/:id/decide", requirePerm("approvals.decide"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ action: z.enum(["approve", "reject"]), note: z.string().optional() }).parse(req.body);
  const ex = await q1<Record<string, any>>("SELECT * FROM policy_exceptions WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!ex) { res.status(404).json({ error: "Exception not found" }); return; }
  if (ex.status !== "pending") { res.status(400).json({ error: "Exception already decided" }); return; }
  await run("UPDATE policy_exceptions SET status = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ?",
    [body.action === "approve" ? "approved" : "rejected", req.user!.id, now(), body.note ?? null, ex.id]);
  await run("INSERT INTO approvals (tenant_id, entity_type, entity_id, action, status, by_user, note) VALUES (?, 'policy_exception', ?, ?, ?, ?, ?)",
    [req.user!.tenant_id, ex.id, body.action, body.action === "approve" ? "approved" : "rejected", req.user!.id, body.note ?? null]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: `policy_exception.${body.action}`, entityType: "policy_exception", entityId: ex.id, before: { status: ex.status }, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM policy_exceptions WHERE id = ?", [ex.id]));
}));

/* ---------- Credit memo / appraisal ---------- */

losExtrasRouter.get("/applications/:id/memo", requirePerm("underwriting.*"), asyncH(async (req: AuthedRequest, res) => {
  const app = await loadApp(req, req.params.id);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const content = await creditMemoContent(app.id);
  let memo = await q1<Record<string, any>>("SELECT * FROM credit_memos WHERE application_id = ? ORDER BY id DESC LIMIT 1", [app.id]);
  if (!memo) {
    const id = (await run("INSERT INTO credit_memos (tenant_id, application_id, memo_no, content, status, created_by) VALUES (?, ?, ?, ?, 'draft', ?)",
      [req.user!.tenant_id, app.id, "MEM" + String(100000 + app.id), JSON.stringify(content), req.user!.id])).lastId;
    memo = await q1("SELECT * FROM credit_memos WHERE id = ?", [id]);
    await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "credit_memo.generate", entityType: "application", entityId: app.id, after: { memo_id: id }, ip: clientIp(req) });
  }
  const memoRow = await q1<Record<string, any>>("SELECT * FROM credit_memos WHERE id = ?", [memo!.id])!;
  res.json({ memo: { ...memoRow, content: JSON.parse(memoRow.content) } });
}));

losExtrasRouter.patch("/applications/:id/memo", requirePerm("underwriting.*"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ status: z.enum(["draft", "submitted", "reviewed", "approved", "rejected", "send_back"]) }).parse(req.body);
  const memo = await q1<Record<string, any>>("SELECT * FROM credit_memos WHERE application_id = ? ORDER BY id DESC LIMIT 1", [req.params.id]);
  if (!memo) { res.status(404).json({ error: "No memo yet — generate first" }); return; }
  await run("UPDATE credit_memos SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?",
    [body.status, body.status === "draft" || body.status === "submitted" ? null : req.user!.id, body.status === "draft" || body.status === "submitted" ? null : now(), memo.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: `credit_memo.${body.status}`, entityType: "credit_memo", entityId: memo.id, before: { status: memo.status }, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM credit_memos WHERE id = ?", [memo.id]));
}));

/* ---------- Offer comparison ---------- */

losExtrasRouter.get("/applications/:id/offers", requirePerm("applications.view"), asyncH(async (req: AuthedRequest, res) => {
  const app = await loadApp(req, req.params.id);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const offers = await q("SELECT * FROM offers WHERE application_id = ? ORDER BY id", [app.id]);
  if (offers.length === 0) {
    const generated = await generateOffers(app.id);
    for (const o of generated.offers) {
      await run("INSERT INTO offers (tenant_id, application_id, label, amount, tenure, rate, emi, apr, fees, total_repayment, risk_grade, conditions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [req.user!.tenant_id, app.id, o.label, o.amount, o.tenure, o.rate, o.emi, o.apr, o.fees, o.total_repayment, o.risk_grade, JSON.stringify(o.conditions)]);
    }
    res.json({ offers: await q("SELECT * FROM offers WHERE application_id = ? ORDER BY id", [app.id]) });
    return;
  }
  res.json({ offers });
}));

losExtrasRouter.post("/applications/:id/offers/:offerId/select", requirePerm("applications.edit"), asyncH(async (req: AuthedRequest, res) => {
  const app = await loadApp(req, req.params.id);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const offer = await q1<Record<string, any>>("SELECT * FROM offers WHERE id = ? AND application_id = ?", [req.params.offerId, app.id]);
  if (!offer) { res.status(404).json({ error: "Offer not found" }); return; }
  await run("UPDATE offers SET selected = 0 WHERE application_id = ?", [app.id]);
  await run("UPDATE offers SET selected = 1 WHERE id = ?", [offer.id]);
  await run("UPDATE applications SET approved_amount = ?, tenure = ?, rate = ?, offer_id = ?, updated_at = datetime('now') WHERE id = ?",
    [offer.amount, offer.tenure, offer.rate, offer.id, app.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "offer.select", entityType: "application", entityId: app.id, before: { amount: app.requested_amount }, after: { offer: offer.label, amount: offer.amount, tenure: offer.tenure, rate: offer.rate }, ip: clientIp(req) });
  res.json({ ok: true, offer });
}));

/* ---------- Co-applicant / guarantor ---------- */

losExtrasRouter.get("/applications/:id/parties", requirePerm("applications.view"), asyncH(async (req: AuthedRequest, res) => {
  const app = await loadApp(req, req.params.id);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  res.json({ rows: await q("SELECT * FROM parties WHERE application_id = ? ORDER BY id", [app.id]) });
}));

losExtrasRouter.post("/applications/:id/parties", requirePerm("applications.edit"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({
    type: z.enum(["co_applicant", "guarantor", "joint"]), name: z.string().min(2), pan: z.string().optional(),
    dob: z.string().optional(), mobile: z.string().optional(), email: z.string().optional(),
    relationship: z.string().optional(), employment_type: z.string().optional(), monthly_income: z.number().optional(),
    consent: z.boolean().optional()
  }).parse(req.body);
  const app = await loadApp(req, req.params.id);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const id = (await run(
    "INSERT INTO parties (tenant_id, application_id, type, name, pan, dob, mobile, email, relationship, employment_type, monthly_income, consent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [req.user!.tenant_id, app.id, body.type, body.name, body.pan ?? null, body.dob ?? null, body.mobile ?? null, body.email ?? null,
     body.relationship ?? null, body.employment_type ?? null, body.monthly_income ?? null, body.consent ? 1 : 0]
  )).lastId;
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: `party.add.${body.type}`, entityType: "application", entityId: app.id, after: { ...body, party_id: id }, ip: clientIp(req) });
  res.json({ id });
}));

/* ---------- Collateral / security ---------- */

losExtrasRouter.get("/applications/:id/collateral", requirePerm("applications.view"), asyncH(async (req: AuthedRequest, res) => {
  const app = await loadApp(req, req.params.id);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const rows = await q("SELECT * FROM collaterals WHERE application_id = ? ORDER BY id", [app.id]);
  res.json({ rows });
}));

losExtrasRouter.post("/applications/:id/collateral", requirePerm("applications.edit"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({
    asset_type: z.string().min(2), owner_name: z.string().optional(), value: z.number().int().positive(),
    valuation: z.number().int().optional(), valuation_date: z.string().optional(), location: z.string().optional(),
    legal_status: z.string().optional(), encumbrance: z.string().optional(), insurance: z.boolean().optional()
  }).parse(req.body);
  const app = await loadApp(req, req.params.id);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const ltv = body.value > 0 ? Math.round((app.requested_amount / body.value) * 1000) / 10 : null;
  const id = (await run(
    "INSERT INTO collaterals (tenant_id, application_id, asset_type, owner_name, value, valuation, valuation_date, location, legal_status, encumbrance, insurance, ltv) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [req.user!.tenant_id, app.id, body.asset_type, body.owner_name ?? null, body.value, body.valuation ?? null, body.valuation_date ?? null,
     body.location ?? null, body.legal_status ?? null, body.encumbrance ?? null, body.insurance ? 1 : 0, ltv]
  )).lastId;
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "collateral.add", entityType: "application", entityId: app.id, after: { ...body, ltv, collateral_id: id }, ip: clientIp(req) });
  res.json({ id, ltv });
}));

losExtrasRouter.patch("/collateral/:id", requirePerm("applications.edit"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({ verification_status: z.enum(["pending", "verified", "rejected"]), note: z.string().optional() }).parse(req.body);
  const col = await q1<Record<string, any>>("SELECT * FROM collaterals WHERE id = ? AND tenant_id = ?", [req.params.id, req.user!.tenant_id]);
  if (!col) { res.status(404).json({ error: "Collateral not found" }); return; }
  await run("UPDATE collaterals SET verification_status = ? WHERE id = ?", [body.verification_status, col.id]);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: `collateral.${body.verification_status}`, entityType: "collateral", entityId: col.id, after: body, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM collaterals WHERE id = ?", [col.id]));
}));

/* ---------- Pre-screening calculator (standalone, for lead-stage checks) ---------- */

losExtrasRouter.post("/eligibility/check", requirePerm("applications.create"), asyncH(async (req: AuthedRequest, res) => {
  const body = z.object({
    product_id: z.number(), requested_amount: z.number().int().positive(), tenure: z.number().int().positive(),
    dob: z.string().optional(), monthly_income: z.number().optional(), credit_score: z.number().optional(),
    existing_emi: z.number().optional(), existing_exposure: z.number().optional()
  }).parse(req.body);
  const product = await q1<Record<string, any>>("SELECT * FROM products WHERE id = ? AND tenant_id = ?", [body.product_id, req.user!.tenant_id]);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  const age = body.dob ? Math.floor((Date.now() - new Date(body.dob).getTime()) / (365.25 * 86400000)) : null;
  const income = body.monthly_income ?? 0;
  const foir = income > 0 && body.existing_emi ? Math.round(((body.existing_emi / income) * 100) * 10) / 10 : null;
  const emi = computeEmi(body.requested_amount, product.interest_rate, body.tenure);
  const dscr = body.existing_emi && body.existing_emi > 0 ? Math.round((income / body.existing_emi) * 100) / 100 : null;
  const checks = [
    { key: "amount", label: "Requested amount", value: inrShort(body.requested_amount), threshold: `${inrShort(product.min_amount)} – ${inrShort(product.max_amount)}`, passed: body.requested_amount >= product.min_amount && body.requested_amount <= product.max_amount, hard: true },
    { key: "tenure", label: "Tenure", value: `${body.tenure} months`, threshold: `${product.min_tenure} – ${product.max_tenure}`, passed: body.tenure >= product.min_tenure && body.tenure <= product.max_tenure, hard: true },
    { key: "age", label: "Age", value: age ? `${age} yrs` : "n/a", threshold: "21 – 65", passed: age === null ? true : age >= 21 && age <= 65, hard: true },
    { key: "income", label: "Monthly income", value: inrShort(income), threshold: "≥ ₹20,000", passed: income >= 20000, hard: true },
    { key: "foir", label: "FOIR", value: foir === null ? "n/a" : `${foir}%`, threshold: "≤ 55%", passed: foir === null ? true : foir <= 55, hard: false },
    { key: "score", label: "Bureau score", value: body.credit_score ? String(body.credit_score) : "not fetched", threshold: "≥ 650", passed: body.credit_score ? body.credit_score >= 650 : true, hard: false },
    { key: "exposure", label: "Existing exposure", value: inrShort(body.existing_exposure ?? 0), threshold: "≤ ₹25L", passed: (body.existing_exposure ?? 0) <= 2500000, hard: false }
  ];
  const failedHard = checks.filter((c) => !c.passed && c.hard);
  const failedSoft = checks.filter((c) => !c.passed && !c.hard);
  const verdict = failedHard.length ? "NOT_ELIGIBLE" : failedSoft.length ? "MAYBE" : "ELIGIBLE";
  res.json({ verdict, checks, reasons: [...failedHard.map((c) => `${c.label}: ${c.value} vs ${c.threshold}`), ...failedSoft.map((c) => `Soft check — ${c.label}: ${c.value} vs ${c.threshold}`)], emi, dscr });
}));
