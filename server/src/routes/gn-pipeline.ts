import { Router } from "express";
import { z } from "zod";
import { q, q1, run } from "../db/connection.js";
import { audit } from "../core/audit.js";
import { asyncH, authRequired, clientIp, requirePerm, type AuthedRequest } from "../middleware.js";
import { gnRef, gnTimeline, gnNotify, gnStatusIndex, gnStatusLabel, computeCommission, gnSettings, effectiveRate, GN_STATUS } from "../core/gn.js";
import { applyLenderWebhook } from "../core/gn-co.js";

export const gnPipelineRouter = Router();
gnPipelineRouter.use(authRequired);

/** Lender webhooks are unauthenticated by design — signature-validated by the lender layer. */
export const gnWebhookRouter = Router();

const T = (req: AuthedRequest) => req.user!.tenant_id;

/* ---------- List / filter ---------- */

gnPipelineRouter.get("/gn/applications", requirePerm("gn.applications.view"), asyncH(async (req: AuthedRequest, res) => {
  const { status, stage, lender_id, partner_id, q: query, source, page = 1, limit = 25, sort = "created_at", dir = "desc" } = req.query as Record<string, string>;
  const where = ["a.tenant_id = ?"];
  const params: unknown[] = [T(req)];
  if (status) { where.push("a.status = ?"); params.push(status); }
  if (stage) { where.push("a.stage = ?"); params.push(stage); }
  if (lender_id) { where.push("a.lender_id = ?"); params.push(Number(lender_id)); }
  if (partner_id) { where.push("a.partner_id = ?"); params.push(Number(partner_id)); }
  if (source) { where.push("a.source = ?"); params.push(source); }
  if (query) { where.push("(a.ref LIKE ? OR a.name LIKE ? OR a.mobile LIKE ?)"); params.push(`%${query}%`, `%${query}%`, `%${query}%`); }
  const total = (await q1<{ n: number }>(`SELECT COUNT(*) AS n FROM gn_applications a WHERE ${where.join(" AND ")}`, params))!.n;
  const off = (Math.max(1, Number(page)) - 1) * Number(limit);
  const rows = await q<Record<string, any>>(
    `SELECT a.*, l.name AS lender_name, p.name AS product_name, p.category AS product_category,
       pt.name AS partner_name, pt.type AS partner_type, u.name AS assigned_name
     FROM gn_applications a
     LEFT JOIN gn_lenders l ON l.id = a.lender_id
     LEFT JOIN gn_products p ON p.id = a.product_id
     LEFT JOIN gn_partners pt ON pt.id = a.partner_id
     LEFT JOIN users u ON u.id = a.assigned_to
     WHERE ${where.join(" AND ")}
     ORDER BY a.${["created_at", "disbursed_at", "amount", "name"].includes(sort) ? sort : "created_at"} ${dir === "asc" ? "ASC" : "DESC"}
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), off]
  );
  const counts = await q1<Record<string, any>>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN stage = 'lender' THEN 1 ELSE 0 END) AS at_lender,
       SUM(CASE WHEN disbursed_amount > 0 THEN 1 ELSE 0 END) AS disbursed,
       SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
     FROM gn_applications WHERE tenant_id = ?`, [T(req)])!;
  res.json({ rows, total, page: Number(page), limit: Number(limit), counts });
}));

/* ---------- Create ---------- */

const appSchema = z.object({
  customer_id: z.number().nullable().optional(),
  name: z.string().min(2), mobile: z.string().optional(), email: z.string().optional(),
  city: z.string().optional(), state: z.string().optional(),
  employment_type: z.string().optional(), monthly_income: z.number().nullable().optional(),
  business_turnover: z.number().nullable().optional(), business_vintage: z.number().nullable().optional(),
  loan_type: z.string().optional(),
  product_id: z.number().nullable().optional(), lender_id: z.number().nullable().optional(), scheme_id: z.number().nullable().optional(),
  dsa_code: z.string().optional(), partner_id: z.number().nullable().optional(), assigned_to: z.number().nullable().optional(),
  amount: z.number().int().positive(), tenure: z.number().int().positive(), purpose: z.string().optional(),
  source: z.string().optional(), status: z.string().optional(),
  is_direct_booking: z.boolean().optional(), is_cross_sell: z.boolean().optional()
});

gnPipelineRouter.post("/gn/applications", requirePerm("gn.applications.create"), asyncH(async (req: AuthedRequest, res) => {
  const b = appSchema.parse(req.body);
  const ref = await gnRef(T(req));
  const id = (await run(
    `INSERT INTO gn_applications (tenant_id, ref, customer_id, name, mobile, email, city, state, employment_type,
       monthly_income, business_turnover, business_vintage, loan_type, product_id, lender_id, scheme_id, dsa_code,
       partner_id, assigned_to, amount, tenure, purpose, source, status, stage, is_direct_booking, is_cross_sell)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [T(req), ref, b.customer_id ?? null, b.name, b.mobile ?? null, b.email ?? null, b.city ?? null, b.state ?? null,
     b.employment_type ?? null, b.monthly_income ?? null, b.business_turnover ?? null, b.business_vintage ?? null,
     b.loan_type ?? null, b.product_id ?? null, b.lender_id ?? null, b.scheme_id ?? null, b.dsa_code ?? null,
     b.partner_id ?? null, b.assigned_to ?? null, b.amount, b.tenure, b.purpose ?? null, b.source ?? "dsa",
     b.status ?? "app_created", gnStageOf(b.status ?? "app_created"), b.is_direct_booking ? 1 : 0, b.is_cross_sell ? 1 : 0]
  )).lastId;
  await gnTimeline(T(req), id, b.is_direct_booking ? "DIRECT BOOKING" : "APPLICATION CREATED", b.is_direct_booking ? "Direct booking logged under DSA code" : `Application ${ref} created`, req.user!.id);
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.application.create", entityType: "gn_application", entityId: id, after: { ref, ...b }, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_applications WHERE id = ?", [id]));
}));

function gnStageOf(status: string): string {
  const s = GN_STATUS.find((x) => x.slug === status);
  return s?.group ?? "application";
}

/* ---------- Detail + timeline ---------- */

gnPipelineRouter.get("/gn/applications/:id", requirePerm("gn.applications.view"), asyncH(async (req: AuthedRequest, res) => {
  const app = await q1<Record<string, any>>(
    `SELECT a.*, l.name AS lender_name, l.api_status AS lender_api_status, p.name AS product_name, p.category AS product_category,
       s.name AS scheme_name, s.payout_type AS scheme_payout_type, s.rate AS scheme_rate, s.slabs AS scheme_slabs,
       pt.name AS partner_name, u.name AS assigned_name
     FROM gn_applications a
     LEFT JOIN gn_lenders l ON l.id = a.lender_id
     LEFT JOIN gn_products p ON p.id = a.product_id
     LEFT JOIN gn_schemes s ON s.id = a.scheme_id
     LEFT JOIN gn_partners pt ON pt.id = a.partner_id
     LEFT JOIN users u ON u.id = a.assigned_to
     WHERE a.id = ? AND a.tenant_id = ?`, [req.params.id, T(req)]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const timeline = await q<Record<string, any>>(
    `SELECT t.*, u.name AS actor_name FROM gn_application_timeline t LEFT JOIN users u ON u.id = t.actor
     WHERE t.app_id = ? ORDER BY t.id`, [app.id]);
  const commission = await q1("SELECT * FROM gn_commissions WHERE app_id = ? ORDER BY id DESC LIMIT 1", [app.id]);
  const docs = await q("SELECT * FROM gn_documents WHERE entity_type = 'application' AND entity_id = ? ORDER BY id DESC", [app.id]);
  res.json({ application: { ...app, commission_rate_effective: effectiveRate(app) }, timeline, commission, docs, statuses: GN_STATUS });
}));

/* ---------- Status advance ---------- */

const ADVANCE_ORDER = ["app_created", "kyc_pending", "kyc_complete", "docs_pending", "docs_complete", "lender_selected", "ready_submission"];

gnPipelineRouter.post("/gn/applications/:id/advance", requirePerm("gn.applications.edit"), asyncH(async (req: AuthedRequest, res) => {
  const app = await q1<Record<string, any>>("SELECT * FROM gn_applications WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const idx = ADVANCE_ORDER.indexOf(app.status);
  const next = idx >= 0 && idx < ADVANCE_ORDER.length - 1 ? ADVANCE_ORDER[idx + 1] : app.status;
  await run("UPDATE gn_applications SET status = ?, stage = ?, updated_at = datetime('now') WHERE id = ?", [next, gnStageOf(next), app.id]);
  await gnTimeline(T(req), app.id, gnStatusLabel(next).toUpperCase(), `Status → ${gnStatusLabel(next)}`, req.user!.id);
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.application.advance", entityType: "gn_application", entityId: app.id, before: { status: app.status }, after: { status: next }, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_applications WHERE id = ?", [app.id]));
}));

gnPipelineRouter.patch("/gn/applications/:id/status", requirePerm("gn.applications.edit"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ status: z.string(), note: z.string().optional(), rejected_reason: z.string().optional(), amount: z.number().optional() }).parse(req.body);
  const app = await q1<Record<string, any>>("SELECT * FROM gn_applications WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  if (!GN_STATUS.some((s) => s.slug === b.status)) { res.status(400).json({ error: "Unknown status" }); return; }
  const sets = ["status = ?", "stage = ?", "updated_at = datetime('now')"];
  const params: unknown[] = [b.status, gnStageOf(b.status)];
  if (b.note) { sets.push("notes = ?"); params.push(b.note); }
  if (b.rejected_reason && b.status === "rejected") { sets.push("rejected_reason = ?"); params.push(b.rejected_reason); }
  if (b.amount && (b.status.startsWith("disb_") || b.status === "disb_confirmed")) { sets.push("disbursed_amount = ?", "disbursed_at = datetime('now')"); params.push(b.amount); }
  params.push(app.id);
  await run(`UPDATE gn_applications SET ${sets.join(", ")} WHERE id = ?`, params);
  const next = await q1<Record<string, any>>(
    `SELECT a.*, s.rate AS scheme_rate, p.payout_pct AS product_payout FROM gn_applications a
     LEFT JOIN gn_schemes s ON s.id = a.scheme_id LEFT JOIN gn_products p ON p.id = a.product_id WHERE a.id = ?`, [app.id])!;
  await gnTimeline(T(req), app.id, gnStatusLabel(b.status).toUpperCase(), b.note ?? `Status → ${gnStatusLabel(b.status)}`, req.user!.id);
  // Auto-create commission on disbursement
  if ((b.status === "disb_fully" || b.status === "disb_confirmed") && next.disbursed_amount > 0 && next.commission_gross === 0) {
    const rate = effectiveRate(next);
    const settings = await gnSettings(T(req));
    const c = computeCommission(next.disbursed_amount, rate, settings);
    await run(
      "UPDATE gn_applications SET commission_rate = ?, commission_gross = ?, commission_tds = ?, commission_net = ? WHERE id = ?",
      [rate, c.gross, c.tds, c.net, app.id]
    );
    await run(
      "INSERT INTO gn_commissions (tenant_id, app_id, lender_id, scheme_id, disbursed_amount, rate, gross, gst, tds, net) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [T(req), app.id, next.lender_id, next.scheme_id, next.disbursed_amount, rate, c.gross, c.gst, c.tds, c.net]
    );
    await gnTimeline(T(req), app.id, "COMMISSION CALCULATED", `₹${c.gross.toLocaleString("en-IN")} gross at ${rate}%`, req.user!.id);
  }
  const beforeRow = await q1<Record<string, any>>("SELECT * FROM gn_applications WHERE id = ?", [app.id]);
  const after = await q1<Record<string, any>>("SELECT * FROM gn_applications WHERE id = ?", [app.id])!;
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.application.status", entityType: "gn_application", entityId: app.id, before: beforeRow, after, ip: clientIp(req) });
  res.json(after);
}));

/* ---------- Submit to lender (mock) ---------- */

gnPipelineRouter.post("/gn/applications/:id/submit", requirePerm("gn.applications.edit"), asyncH(async (req: AuthedRequest, res) => {
  const app = await q1<Record<string, any>>("SELECT * FROM gn_applications WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  if (!app.lender_id) { res.status(400).json({ error: "Select a lender before submitting" }); return; }
  await run("UPDATE gn_applications SET status = 'submitted', stage = 'lender', submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [app.id]);
  await gnTimeline(T(req), app.id, "APPLICATION SUBMITTED", `Submitted to ${app.lender_name ?? "lender"}`, req.user!.id);
  await gnNotify(T(req), app.assigned_to, "Application submitted", `${app.ref} submitted to lender for underwriting`);
  res.json(await q1("SELECT * FROM gn_applications WHERE id = ?", [app.id]));
}));

/* ---------- Mock lender simulator ---------- */

gnPipelineRouter.post("/gn/applications/:id/mock-lender", requirePerm("gn.applications.edit"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ action: z.enum(["underwrite", "approve", "reject", "agreement", "disburse", "fund", "confirm", "crm", "reconcile"]), amount: z.number().optional(), note: z.string().optional() }).parse(req.body);
  const app = await q1<Record<string, any>>("SELECT * FROM gn_applications WHERE id = ? AND tenant_id = ?", [req.params.id, T(req)]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const t = T(req);
  const transitions: Record<string, { status: string; event: string; note: string }> = {
    underwrite: { status: "uw", event: "UNDERWRITING STARTED", note: "Mock lender began underwriting" },
    approve: { status: "approved", event: "APPROVED", note: "Mock lender approved the application" },
    reject: { status: "rejected", event: "REJECTED", note: b.note ?? "Mock lender rejected the application" },
    agreement: { status: "agreement_completed", event: "AGREEMENT / ESIGN COMPLETED", note: "Agreement & eSign completed" },
    disburse: { status: "disb_initiated", event: "DISBURSEMENT TRIGGERED BY LENDER", note: `Lender initiated disbursement of ₹${(b.amount ?? app.amount).toLocaleString("en-IN")}` },
    fund: { status: "disb_fully", event: "FUNDS TRANSFERRED TO BORROWER", note: `₹${(b.amount ?? app.amount).toLocaleString("en-IN")} credited to borrower's bank account` },
    confirm: { status: "disb_confirmed", event: "DISBURSEMENT CONFIRMED", note: "Lender confirmed disbursement" },
    crm: { status: "crm_updated", event: "GROWTH NATIONS CRM UPDATED", note: "CRM automatically updated with disbursement" },
    reconcile: { status: "commission_reconciled", event: "COMMISSION / PAYOUT RECONCILED", note: "Commission calculated & payout tracked" }
  };
  const tr = transitions[b.action];
  const amount = b.amount ?? (b.action === "disburse" || b.action === "confirm" ? app.amount : 0);
  const sets: string[] = ["status = ?", "stage = ?", "updated_at = datetime('now')"];
  const params: unknown[] = [tr.status, gnStageOf(tr.status)];
  if (b.action === "reject") { sets.push("rejected_reason = ?"); params.push(b.note ?? "Rejected by lender"); }
  if (b.action === "approve") { sets.push("sanctioned_at = datetime('now')"); }
  if (b.action === "disburse" || b.action === "fund" || b.action === "confirm") {
    sets.push("disbursed_amount = ?", "disbursed_at = datetime('now')");
    params.push(amount);
  }
  params.push(app.id);
  await run(`UPDATE gn_applications SET ${sets.join(", ")} WHERE id = ?`, params);
  await gnTimeline(t, app.id, tr.event, tr.note, req.user!.id);
  const next = await q1<Record<string, any>>(
    `SELECT a.*, s.rate AS scheme_rate, p.payout_pct AS product_payout FROM gn_applications a
     LEFT JOIN gn_schemes s ON s.id = a.scheme_id LEFT JOIN gn_products p ON p.id = a.product_id WHERE a.id = ?`, [app.id])!;
  if (b.action === "disburse" || b.action === "fund" || b.action === "confirm") {
    if (next.disbursed_amount > 0 && next.commission_gross === 0) {
      const rate = effectiveRate(next);
      const settings = await gnSettings(t);
      const c = computeCommission(next.disbursed_amount, rate, settings);
      await run("UPDATE gn_applications SET commission_rate = ?, commission_gross = ?, commission_tds = ?, commission_net = ? WHERE id = ?", [rate, c.gross, c.tds, c.net, app.id]);
      await run("INSERT INTO gn_commissions (tenant_id, app_id, lender_id, scheme_id, disbursed_amount, rate, gross, gst, tds, net) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [t, app.id, next.lender_id, next.scheme_id, next.disbursed_amount, rate, c.gross, c.gst, c.tds, c.net]);
      await gnTimeline(t, app.id, "COMMISSION CALCULATED", `₹${c.gross.toLocaleString("en-IN")} gross at ${rate}%`, req.user!.id);
    }
    await gnNotify(t, next.assigned_to, "Loan disbursed", `${next.ref} — ₹${amount.toLocaleString("en-IN")} disbursed by lender`);
  }
  await audit({ tenantId: t, userId: req.user!.id, action: `gn.mock_lender.${b.action}`, entityType: "gn_application", entityId: app.id, before: { status: app.status }, after: { status: tr.status, amount }, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_applications WHERE id = ?", [app.id]));
}));

/* ---------- Mock lender webhook receiver ---------- */

gnWebhookRouter.post("/gn/webhooks/lender/:lenderId", asyncH(async (req: AuthedRequest, res) => {
  // Lender webhooks are authenticated by signature, not user session
  const lender = await q1<Record<string, any>>("SELECT * FROM gn_lenders WHERE id = ?", [req.params.lenderId]);
  if (!lender) { res.status(404).json({ error: "Lender not found" }); return; }
  const b = z.object({ app_ref: z.string(), event: z.string(), amount: z.number().optional(), utr: z.string().optional() }).parse(req.body);
  const app = await q1<Record<string, any>>("SELECT id FROM gn_applications WHERE ref = ? AND tenant_id = ?", [b.app_ref, lender.tenant_id]);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const evtId = (await run(
    "INSERT INTO gn_webhook_events (tenant_id, provider, event, app_id, request_id, payload, status) VALUES (?, ?, ?, ?, ?, ?, 'received')",
    [lender.tenant_id, lender.name, b.event, app.id, `WH-${Date.now()}`, JSON.stringify(b)]
  )).lastId;
  const out = await applyLenderWebhook(lender.tenant_id, app.id, b.event, b.amount, b.utr);
  if (!out.ok) {
    await run("UPDATE gn_webhook_events SET status = 'failed', error = ? WHERE id = ?", [out.error, evtId]);
    res.status(400).json({ error: out.error });
    return;
  }
  const status = out.duplicate ? "received" : "processed";
  await run("UPDATE gn_webhook_events SET status = ?, processed_at = datetime('now') WHERE id = ?", [status, evtId]);
  await audit({ tenantId: lender.tenant_id, userId: null, action: `gn.webhook.${b.event}`, entityType: "gn_application", entityId: app.id, after: { event: b.event, amount: b.amount, utr: b.utr, duplicate: !!out.duplicate }, ip: clientIp(req) });
  res.json({ ok: true, status: out.status, duplicate: !!out.duplicate });
}));

/* ---------- Cross-selling pool ---------- */

gnPipelineRouter.get("/gn/cross-selling", requirePerm("gn.applications.view"), asyncH(async (req: AuthedRequest, res) => {
  const { months = 12 } = req.query as Record<string, string>;
  const rows = await q<Record<string, any>>(
    `SELECT a.id, a.ref, a.name, a.mobile, a.lender_id, l.name AS lender_name, a.disbursed_amount, a.disbursed_at,
       CAST((julianday('now') - julianday(a.disbursed_at)) / 30 AS INTEGER) AS aged_months
     FROM gn_applications a JOIN gn_lenders l ON l.id = a.lender_id
     WHERE a.tenant_id = ? AND a.disbursed_amount > 0
       AND CAST((julianday('now') - julianday(a.disbursed_at)) / 30 AS INTEGER) >= ?
     ORDER BY a.disbursed_at`, [T(req), Number(months)]);
  res.json({ rows, poolSize: rows.length, months: Number(months) });
}));

/* ---------- Direct booking ---------- */

gnPipelineRouter.post("/gn/direct-bookings", requirePerm("gn.applications.edit"), asyncH(async (req: AuthedRequest, res) => {
  const b = appSchema.extend({ dsa_code: z.string() }).parse(req.body);
  const ref = await gnRef(T(req));
  const id = (await run(
    `INSERT INTO gn_applications (tenant_id, ref, customer_id, name, mobile, email, city, state, employment_type,
       monthly_income, business_turnover, business_vintage, loan_type, product_id, lender_id, scheme_id, dsa_code,
       partner_id, assigned_to, amount, tenure, purpose, source, status, stage, is_direct_booking, disbursed_amount, disbursed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'direct_booking', 'disb_confirmed', 'completed', 1, ?, datetime('now'))`,
    [T(req), ref, b.customer_id ?? null, b.name, b.mobile ?? null, b.email ?? null, b.city ?? null, b.state ?? null,
     b.employment_type ?? null, b.monthly_income ?? null, b.business_turnover ?? null, b.business_vintage ?? null,
     b.loan_type ?? null, b.product_id ?? null, b.lender_id ?? null, b.scheme_id ?? null, b.dsa_code,
     b.partner_id ?? null, b.assigned_to ?? null, b.amount, b.tenure, b.purpose ?? null, b.amount]
  )).lastId;
  await gnTimeline(T(req), id, "DIRECT BOOKING", `Disbursed file logged under DSA code ${b.dsa_code}`, req.user!.id);
  const app = await q1<Record<string, any>>(
    `SELECT a.*, s.rate AS scheme_rate, p.payout_pct AS product_payout FROM gn_applications a
     LEFT JOIN gn_schemes s ON s.id = a.scheme_id LEFT JOIN gn_products p ON p.id = a.product_id WHERE a.id = ?`, [id])!;
  const rate = effectiveRate(app);
  const settings = await gnSettings(T(req));
  const c = computeCommission(app.disbursed_amount, rate, settings);
  await run("UPDATE gn_applications SET commission_rate = ?, commission_gross = ?, commission_tds = ?, commission_net = ? WHERE id = ?", [rate, c.gross, c.tds, c.net, id]);
  await run("INSERT INTO gn_commissions (tenant_id, app_id, lender_id, scheme_id, disbursed_amount, rate, gross, gst, tds, net) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [T(req), id, app.lender_id, app.scheme_id, app.disbursed_amount, rate, c.gross, c.gst, c.tds, c.net]);
  await audit({ tenantId: T(req), userId: req.user!.id, action: "gn.direct_booking", entityType: "gn_application", entityId: id, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_applications WHERE id = ?", [id]));
}));
