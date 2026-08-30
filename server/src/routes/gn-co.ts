import { Router } from "express";
import { z } from "zod";
import { q, q1, run } from "../db/connection.js";
import { audit } from "../core/audit.js";
import { asyncH, authRequired, clientIp, requirePerm, type AuthedRequest } from "../middleware.js";
import {
  applicantRef, aplEvent, grantConsent, matchApplicant, runCredit, runKyc, runDemoScenario,
  sendOtp, storeMatches, verifyOtp, createApplication, submitApplication, simulateLender, safeJson
} from "../core/gn-co.js";
import { gnTimeline, gnStatusLabel } from "../core/gn.js";

export const gnCoRouter = Router();
gnCoRouter.use(authRequired);

const T = (req: AuthedRequest) => req.user!.tenant_id;

/* ================= Overview ================= */

const APP_RANK = `CASE app_status WHEN 'payout' THEN 9 WHEN 'disbursed' THEN 8 WHEN 'disb_initiated' THEN 7
  WHEN 'agreement' THEN 6 WHEN 'sanctioned' THEN 5 WHEN 'approved' THEN 4 WHEN 'uw' THEN 3 WHEN 'submitted' THEN 2
  WHEN 'created' THEN 1 ELSE 0 END`;

gnCoRouter.get("/gn/co/overview", requirePerm("gn.co.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const one = async <T2>(sql: string, params: unknown[] = []): Promise<T2> => await q1<T2>(sql, params) as T2;
  const kpi = await one<Record<string, any>>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) AS new_today,
       SUM(CASE WHEN kyc_status = 'completed' THEN 1 ELSE 0 END) AS kyc_completed,
       SUM(CASE WHEN ${APP_RANK} >= 2 THEN 1 ELSE 0 END) AS submitted,
       SUM(CASE WHEN ${APP_RANK} >= 4 THEN 1 ELSE 0 END) AS approved,
       SUM(CASE WHEN ${APP_RANK} >= 8 THEN 1 ELSE 0 END) AS disbursed
     FROM gn_applicants WHERE tenant_id = ?`, [t]);
  const payouts = await one<Record<string, any>>(
    `SELECT COALESCE(SUM(disbursed_amount), 0) AS disbursed_amount, COALESCE(SUM(gross), 0) AS expected_payout,
       COALESCE(SUM(CASE WHEN status = 'received' THEN gross ELSE 0 END), 0) AS payout_received
     FROM gn_payouts WHERE tenant_id = ?`, [t]);
  const funnel = await one<Record<string, any>>(
    `SELECT COUNT(*) AS applicants,
       SUM(CASE WHEN kyc_status IN ('processing','completed','failed','manual_review') OR otp_status = 'verified' THEN 1 ELSE 0 END) AS kyc_started,
       SUM(CASE WHEN kyc_status = 'completed' THEN 1 ELSE 0 END) AS kyc_completed,
       SUM(CASE WHEN match_status = 'completed' THEN 1 ELSE 0 END) AS eligible,
       SUM(CASE WHEN ${APP_RANK} >= 1 THEN 1 ELSE 0 END) AS applications_created,
       SUM(CASE WHEN ${APP_RANK} >= 2 THEN 1 ELSE 0 END) AS applications_submitted,
       SUM(CASE WHEN ${APP_RANK} >= 3 THEN 1 ELSE 0 END) AS underwriting,
       SUM(CASE WHEN ${APP_RANK} >= 4 THEN 1 ELSE 0 END) AS approved,
       SUM(CASE WHEN ${APP_RANK} >= 6 THEN 1 ELSE 0 END) AS agreements,
       SUM(CASE WHEN ${APP_RANK} >= 7 THEN 1 ELSE 0 END) AS disb_initiated,
       SUM(CASE WHEN ${APP_RANK} >= 8 THEN 1 ELSE 0 END) AS disbursed,
       SUM(CASE WHEN ${APP_RANK} >= 9 THEN 1 ELSE 0 END) AS payout_received
     FROM gn_applicants WHERE tenant_id = ?`, [t]);
  const byLender = await q<Record<string, any>>(
    `SELECT d.lender_id, l.name AS lender_name, COUNT(*) AS n, COALESCE(SUM(d.amount), 0) AS amount
     FROM gn_disbursements d JOIN gn_lenders l ON l.id = d.lender_id
     WHERE d.tenant_id = ? AND d.status = 'completed' GROUP BY d.lender_id ORDER BY amount DESC LIMIT 6`, [t]);
  const recent = await q<Record<string, any>>(
    `SELECT a.id, a.ref, a.name, a.loan_type, a.loan_amount, a.app_status, a.kyc_status, a.match_status, a.credit_score, a.created_at
     FROM gn_applicants a WHERE a.tenant_id = ? ORDER BY a.id DESC LIMIT 8`, [t]);
  res.json({ kpi, payouts, funnel, byLender, recent });
}));

/* ================= Applicants ================= */

const TAB_WHERE: Record<string, string> = {
  all: "1 = 1",
  kyc: "kyc_status IN ('consent_required','pending','processing','failed','manual_review')",
  credit: "credit_status IN ('consent_required','requested','processing','failed','manual_review')",
  match: "match_status IN ('not_run','running','no_match') AND kyc_status = 'completed'",
  docs: "doc_status IN ('pending','in_progress') AND app_status != 'none'",
  uw: "app_status = 'uw'",
  sanction: "app_status IN ('approved','sanctioned')",
  disbursement: "app_status IN ('disb_initiated')",
  payout: "app_status IN ('disbursed','payout')"
};

gnCoRouter.get("/gn/co/applicants", requirePerm("gn.co.view"), asyncH(async (req: AuthedRequest, res) => {
  const { tab = "all", q: query = "", loan_type = "", source = "", page = 1, limit = 25 } = req.query as Record<string, string>;
  const where = ["a.tenant_id = ?", TAB_WHERE[tab] ?? "1 = 1"];
  const params: unknown[] = [T(req)];
  if (query) { where.push("(a.ref LIKE ? OR a.name LIKE ? OR a.mobile LIKE ?)"); params.push(`%${query}%`, `%${query}%`, `%${query}%`); }
  if (loan_type) { where.push("a.loan_type = ?"); params.push(loan_type); }
  if (source) { where.push("a.source = ?"); params.push(source); }
  const total = (await q1<{ n: number }>(`SELECT COUNT(*) AS n FROM gn_applicants a WHERE ${where.join(" AND ")}`, params))!.n;
  const off = (Math.max(1, Number(page)) - 1) * Number(limit);
  const rows = await q<Record<string, any>>(
    `SELECT a.*, (SELECT ref FROM gn_applications WHERE applicant_id = a.id ORDER BY id DESC LIMIT 1) AS app_ref,
       (SELECT status FROM gn_applications WHERE applicant_id = a.id ORDER BY id DESC LIMIT 1) AS app_status_detail,
       (SELECT name FROM gn_lender_matches WHERE applicant_id = a.id AND selected = 1 ORDER BY id DESC LIMIT 1) AS selected_lender
     FROM gn_applicants a WHERE ${where.join(" AND ")}
     ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    [...params, Number(limit), off]);
  const counts = await q1<Record<string, any>>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN ${APP_RANK} >= 2 THEN 1 ELSE 0 END) AS submitted,
       SUM(CASE WHEN ${APP_RANK} >= 8 THEN 1 ELSE 0 END) AS disbursed
     FROM gn_applicants WHERE tenant_id = ?`, [T(req)])!;
  res.json({ rows, total, page: Number(page), limit: Number(limit), counts });
}));

const applicantSchema = z.object({
  name: z.string().min(2), mobile: z.string().optional(), email: z.string().optional(), pan: z.string().optional(),
  dob: z.string().optional(), gender: z.string().optional(), city: z.string().optional(), state: z.string().optional(), pincode: z.string().optional(),
  applicant_type: z.string().optional(), employment_type: z.string().optional(),
  employer: z.string().optional(), designation: z.string().optional(), years_employed: z.number().nullable().optional(),
  business_name: z.string().optional(), business_type: z.string().optional(), business_vintage: z.number().nullable().optional(),
  industry: z.string().optional(), employees: z.number().nullable().optional(),
  monthly_income: z.number().nullable().optional(), annual_income: z.number().nullable().optional(),
  annual_turnover: z.number().nullable().optional(), net_profit: z.number().nullable().optional(),
  gst: z.string().optional(), udyam: z.string().optional(),
  existing_emi: z.number().nullable().optional(), existing_loans: z.number().nullable().optional(),
  bank_name: z.string().optional(), bank_account: z.string().optional(), ifsc: z.string().optional(),
  loan_type: z.string().optional(), loan_amount: z.number().nullable().optional(), tenure: z.number().nullable().optional(),
  purpose: z.string().optional(), collateral: z.string().optional(), property_type: z.string().optional(),
  source: z.string().optional(), campaign: z.string().optional(), builder: z.string().optional(), oem: z.string().optional(),
  dsa_code: z.string().optional(), notes: z.string().optional()
});

gnCoRouter.post("/gn/co/applicants", requirePerm("gn.co.create"), asyncH(async (req: AuthedRequest, res) => {
  const b = applicantSchema.parse(req.body);
  const t = T(req);
  const ref = await applicantRef(t);
  const id = (await run(
    `INSERT INTO gn_applicants (tenant_id, ref, name, mobile, email, pan, dob, gender, city, state, pincode, applicant_type,
       employment_type, employer, designation, years_employed, business_name, business_type, business_vintage, industry, employees,
       monthly_income, annual_income, annual_turnover, net_profit, gst, udyam, existing_emi, existing_loans, bank_name, bank_account, ifsc,
       loan_type, loan_amount, tenure, purpose, collateral, property_type, source, campaign, builder, oem, dsa_code, notes, assigned_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [t, ref, b.name, b.mobile ?? null, b.email ?? null, b.pan ?? null, b.dob ?? null, b.gender ?? null, b.city ?? null, b.state ?? null, b.pincode ?? null,
     b.applicant_type ?? "Individual", b.employment_type ?? null, b.employer ?? null, b.designation ?? null, b.years_employed ?? null,
     b.business_name ?? null, b.business_type ?? null, b.business_vintage ?? null, b.industry ?? null, b.employees ?? null,
     b.monthly_income ?? null, b.annual_income ?? null, b.annual_turnover ?? null, b.net_profit ?? null, b.gst ?? null, b.udyam ?? null,
     b.existing_emi ?? 0, b.existing_loans ?? 0, b.bank_name ?? null, b.bank_account ?? null, b.ifsc ?? null,
     b.loan_type ?? null, b.loan_amount ?? null, b.tenure ?? null, b.purpose ?? null, b.collateral ?? null, b.property_type ?? null,
     b.source ?? "manual", b.campaign ?? null, b.builder ?? null, b.oem ?? null, b.dsa_code ?? null, b.notes ?? null, req.user!.id]
  )).lastId;
  await aplEvent(t, id, "APPLICANT CREATED", `${ref} created`, req.user!.id);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.co.applicant.create", entityType: "gn_applicant", entityId: id, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_applicants WHERE id = ?", [id]));
}));

gnCoRouter.get("/gn/co/applicants/:id", requirePerm("gn.co.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const a = await q1<Record<string, any>>("SELECT * FROM gn_applicants WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!a) { res.status(404).json({ error: "Applicant not found" }); return; }
  const events = await q<Record<string, any>>(`SELECT e.*, u.name AS actor_name FROM gn_applicant_events e LEFT JOIN users u ON u.id = e.actor WHERE e.applicant_id = ? ORDER BY e.id DESC LIMIT 40`, [a.id]);
  const consents = await q<Record<string, any>>("SELECT * FROM gn_consents WHERE applicant_id = ? ORDER BY id DESC", [a.id]);
  const kyc = await q<Record<string, any>>("SELECT * FROM gn_kyc WHERE applicant_id = ? ORDER BY id", [a.id]);
  const credit = await q<Record<string, any>>("SELECT * FROM gn_credit_profiles WHERE applicant_id = ? ORDER BY id DESC LIMIT 1", [a.id]);
  const matches = await q<Record<string, any>>("SELECT * FROM gn_lender_matches WHERE applicant_id = ? ORDER BY CASE status WHEN 'eligible' THEN 0 WHEN 'maybe' THEN 1 ELSE 2 END, score DESC", [a.id]);
  const apps = await q<Record<string, any>>(
    `SELECT ga.*, l.name AS lender_name, p.name AS product_name, p.category AS product_category, s.name AS scheme_name
     FROM gn_applications ga LEFT JOIN gn_lenders l ON l.id = ga.lender_id LEFT JOIN gn_products p ON p.id = ga.product_id
     LEFT JOIN gn_schemes s ON s.id = ga.scheme_id WHERE ga.applicant_id = ? ORDER BY ga.id DESC`, [a.id]);
  const appId = apps[0]?.id ?? null;
  const docs = appId ? await q<Record<string, any>>("SELECT * FROM gn_documents WHERE tenant_id = ? AND entity_type = 'application' AND entity_id = ? ORDER BY id", [t, appId]) : [];
  const sanctions = await q<Record<string, any>>("SELECT * FROM gn_sanctions WHERE applicant_id = ? ORDER BY id DESC", [a.id]);
  const agreements = await q<Record<string, any>>("SELECT * FROM gn_agreements WHERE applicant_id = ? ORDER BY id DESC", [a.id]);
  const disbursements = await q<Record<string, any>>("SELECT * FROM gn_disbursements WHERE applicant_id = ? ORDER BY id DESC", [a.id]);
  const payouts = await q<Record<string, any>>("SELECT * FROM gn_payouts WHERE applicant_id = ? ORDER BY id DESC", [a.id]);
  const timeline = appId ? await q<Record<string, any>>(`SELECT t.*, u.name AS actor_name FROM gn_application_timeline t LEFT JOIN users u ON u.id = t.actor WHERE t.app_id = ? ORDER BY t.id`, [appId]) : [];
  res.json({ applicant: a, events, consents, kyc, credit, matches, applications: apps, docs, sanctions, agreements, disbursements, payouts, timeline });
}));

gnCoRouter.patch("/gn/co/applicants/:id", requirePerm("gn.co.edit"), asyncH(async (req: AuthedRequest, res) => {
  const b = applicantSchema.partial().parse(req.body);
  const t = T(req);
  const before = await q1<Record<string, any>>("SELECT * FROM gn_applicants WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!before) { res.status(404).json({ error: "Applicant not found" }); return; }
  const sets = Object.keys(b).map((k) => `${k} = ?`);
  sets.push("updated_at = datetime('now')");
  await run(`UPDATE gn_applicants SET ${sets.join(", ")} WHERE id = ?`, [...Object.values(b), before.id]);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.co.applicant.update", entityType: "gn_applicant", entityId: before.id, before, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_applicants WHERE id = ?", [before.id]));
}));

/* ================= Pipeline actions ================= */

const getApplicant = async (t: number, id: string) => {
  const a = await q1<Record<string, any>>("SELECT * FROM gn_applicants WHERE id = ? AND tenant_id = ?", [id, t]);
  if (!a) { const err: any = new Error("Applicant not found"); err.status = 404; throw err; }
  return a;
};

gnCoRouter.post("/gn/co/applicants/:id/otp", requirePerm("gn.co.edit"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ action: z.enum(["send", "verify"]), otp: z.string().optional() }).parse(req.body);
  const t = T(req);
  await getApplicant(t, req.params.id);
  if (b.action === "send") { res.json(await sendOtp(t, Number(req.params.id), req.user!.id)); return; }
  const out = await verifyOtp(t, Number(req.params.id), b.otp ?? "", req.user!.id);
  if (!out.ok) { res.status(400).json(out); return; }
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.co.otp.verify", entityType: "gn_applicant", entityId: Number(req.params.id), after: { ok: true }, ip: clientIp(req) });
  res.json(out);
}));

gnCoRouter.post("/gn/co/applicants/:id/consent", requirePerm("gn.co.edit"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ purpose: z.string().optional() }).parse(req.body);
  const t = T(req);
  await getApplicant(t, req.params.id);
  await grantConsent(t, Number(req.params.id), b.purpose ?? "Loan application, KYC, credit information & lender sharing", req.user!.id);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.co.consent", entityType: "gn_applicant", entityId: Number(req.params.id), after: b, ip: clientIp(req) });
  res.json({ ok: true, consent_status: "received" });
}));

gnCoRouter.post("/gn/co/applicants/:id/kyc", requirePerm("gn.co.edit"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const a = await getApplicant(t, req.params.id);
  if (a.consent_status !== "received") { res.status(400).json({ error: "Consent required before KYC — capture consent first" }); return; }
  await runKyc(t, a.id, req.user!.id);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.co.kyc", entityType: "gn_applicant", entityId: a.id, after: { provider: "Demo KYC Provider" }, ip: clientIp(req) });
  res.json({ ok: true, kyc_status: "completed" });
}));

gnCoRouter.post("/gn/co/applicants/:id/credit", requirePerm("gn.co.edit"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const a = await getApplicant(t, req.params.id);
  if (a.consent_status !== "received") { res.status(400).json({ error: "Consent required before fetching credit profile" }); return; }
  const profile = await runCredit(t, a.id, req.user!.id);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.co.credit", entityType: "gn_applicant", entityId: a.id, after: { score: profile.score, demo: true }, ip: clientIp(req) });
  res.json({ ok: true, profile });
}));

gnCoRouter.post("/gn/co/applicants/:id/match", requirePerm("gn.co.edit"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const a = await getApplicant(t, req.params.id);
  const matches = await matchApplicant(t, a);
  let withIds: any[] = matches;
  if (matches.length) {
    const ids = await storeMatches(t, a.id, matches);
    withIds = matches.map((m, i) => ({ ...m, id: ids[i] }));
  }
  await run("UPDATE gn_applicants SET match_status = ?, updated_at = datetime('now') WHERE id = ?", [matches.length ? "completed" : "no_match", a.id]);
  await aplEvent(t, a.id, matches.length ? "LENDER MATCH COMPLETED" : "NO MATCH", matches.length ? `${matches.filter((m) => m.status === "eligible").length} eligible products found` : "No eligible product found", req.user!.id);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.co.match", entityType: "gn_applicant", entityId: a.id, after: { matches: matches.length }, ip: clientIp(req) });
  res.json({ matches: withIds, summary: { eligible: matches.filter((m) => m.status === "eligible").length, maybe: matches.filter((m) => m.status === "maybe").length, notEligible: matches.filter((m) => m.status === "not_eligible").length } });
}));

gnCoRouter.post("/gn/co/applicants/:id/apply", requirePerm("gn.co.create"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ match_id: z.number().nullable().optional(), amount: z.number().nullable().optional(), tenure: z.number().nullable().optional() }).parse(req.body);
  const t = T(req);
  const a = await getApplicant(t, req.params.id);
  const appId = await createApplication(t, a, { match_id: b.match_id ?? undefined, amount: b.amount ?? undefined, tenure: b.tenure ?? undefined }, req.user!.id);
  const app = await q1<Record<string, any>>(
    `SELECT ga.*, l.name AS lender_name, p.name AS product_name FROM gn_applications ga
     LEFT JOIN gn_lenders l ON l.id = ga.lender_id LEFT JOIN gn_products p ON p.id = ga.product_id WHERE ga.id = ?`, [appId]);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.co.application.create", entityType: "gn_application", entityId: appId, after: b, ip: clientIp(req) });
  res.json({ ok: true, application: app });
}));

gnCoRouter.post("/gn/co/applicants/:id/submit", requirePerm("gn.co.edit"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const a = await getApplicant(t, req.params.id);
  const app = await q1<Record<string, any>>("SELECT * FROM gn_applications WHERE applicant_id = ? ORDER BY id DESC LIMIT 1", [a.id]);
  if (!app) { res.status(400).json({ error: "Create the application first" }); return; }
  const next = await submitApplication(t, app.id, req.user!.id);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.co.submit", entityType: "gn_application", entityId: app.id, after: { status: "submitted" }, ip: clientIp(req) });
  res.json({ ok: true, application: next });
}));

gnCoRouter.post("/gn/co/applicants/:id/lender", requirePerm("gn.co.edit"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ action: z.enum(["underwrite", "approve", "reject", "sanction", "agreement", "disburse", "fund", "confirm", "payout"]), amount: z.number().nullable().optional(), utr: z.string().optional() }).parse(req.body);
  const t = T(req);
  const a = await getApplicant(t, req.params.id);
  const app = await q1<Record<string, any>>("SELECT * FROM gn_applications WHERE applicant_id = ? ORDER BY id DESC LIMIT 1", [a.id]);
  if (!app) { res.status(400).json({ error: "Create the application first" }); return; }
  const next = await simulateLender(t, app.id, b.action, req.user!.id, { amount: b.amount ?? undefined, utr: b.utr });
  await audit({ tenantId: t, userId: req.user!.id, action: `gn.co.lender.${b.action}`, entityType: "gn_application", entityId: app.id, before: { status: app.status }, after: { status: next.status }, ip: clientIp(req) });
  res.json({ ok: true, application: next });
}));

gnCoRouter.post("/gn/co/documents/:id", requirePerm("gn.co.edit"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ status: z.enum(["uploaded", "verified", "rejected", "not_required", "pending"]), note: z.string().optional() }).parse(req.body);
  const t = T(req);
  const doc = await q1<Record<string, any>>("SELECT * FROM gn_documents WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  await run("UPDATE gn_documents SET status = ?, verified_at = CASE WHEN ? IN ('verified','rejected') THEN datetime('now') ELSE verified_at END WHERE id = ?", [b.status, b.status, doc.id]);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.co.document.status", entityType: "gn_document", entityId: doc.id, before: { status: doc.status }, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_documents WHERE id = ?", [doc.id]));
}));

gnCoRouter.post("/gn/co/applicants/:id/docs-complete", requirePerm("gn.co.edit"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const a = await getApplicant(t, req.params.id);
  const app = await q1<Record<string, any>>("SELECT * FROM gn_applications WHERE applicant_id = ? ORDER BY id DESC LIMIT 1", [a.id]);
  if (!app) { res.status(400).json({ error: "Create the application first" }); return; }
  await run("UPDATE gn_documents SET status = 'verified', verified_at = datetime('now') WHERE tenant_id = ? AND entity_type = 'application' AND entity_id = ? AND status = 'pending'", [t, app.id]);
  await run("UPDATE gn_applicants SET doc_status = 'completed', updated_at = datetime('now') WHERE id = ?", [a.id]);
  res.json({ ok: true, doc_status: "completed" });
}));

/* ================= Demo scenario ================= */

gnCoRouter.post("/gn/co/demo", requirePerm("gn.co.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const out = await runDemoScenario(t, req.user!.id);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.co.demo.run", entityType: "gn_applicant", entityId: out.applicantId, after: { appId: out.appId, ref: out.ref }, ip: clientIp(req) });
  res.json(out);
}));

/* ================= Analytics ================= */

gnCoRouter.get("/gn/co/analytics", requirePerm("gn.co.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const funnel = await q1<Record<string, any>>(
    `SELECT COUNT(*) AS applicants,
       SUM(CASE WHEN kyc_status = 'completed' THEN 1 ELSE 0 END) AS kyc,
       SUM(CASE WHEN ${APP_RANK} >= 1 THEN 1 ELSE 0 END) AS apps,
       SUM(CASE WHEN ${APP_RANK} >= 4 THEN 1 ELSE 0 END) AS sanctions,
       SUM(CASE WHEN ${APP_RANK} >= 8 THEN 1 ELSE 0 END) AS disbursements
     FROM gn_applicants WHERE tenant_id = ?`, [t]);
  const byLender = await q<Record<string, any>>(
    `SELECT l.name AS lender, COUNT(d.id) AS n, COALESCE(SUM(d.amount), 0) AS amount
     FROM gn_disbursements d JOIN gn_lenders l ON l.id = d.lender_id WHERE d.tenant_id = ? AND d.status = 'completed'
     GROUP BY l.id ORDER BY amount DESC`, [t]);
  const byProduct = await q<Record<string, any>>(
    `SELECT loan_type AS product, COUNT(*) AS n, COALESCE(SUM(loan_amount), 0) AS amount
     FROM gn_applicants WHERE tenant_id = ? AND app_status != 'none' GROUP BY loan_type ORDER BY n DESC`, [t]);
  const byPartner = await q<Record<string, any>>(
    `SELECT p.name AS partner, COUNT(a.id) AS n, COALESCE(SUM(a.disbursed_amount), 0) AS amount
     FROM gn_applications a JOIN gn_partners p ON p.id = a.partner_id WHERE a.tenant_id = ? AND a.disbursed_amount > 0
     GROUP BY p.id ORDER BY amount DESC LIMIT 8`, [t]);
  const revenue = await q1<Record<string, any>>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(disbursed_amount), 0) AS disbursed, COALESCE(SUM(gross), 0) AS gross,
       COALESCE(SUM(partner_share), 0) AS partner_share, COALESCE(SUM(gn_share), 0) AS gn_share
     FROM gn_payouts WHERE tenant_id = ?`, [t]);
  const trend = await q<Record<string, any>>(
    `SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS applicants,
       COALESCE(SUM(CASE WHEN ${APP_RANK} >= 2 THEN 1 ELSE 0 END), 0) AS submitted
     FROM gn_applicants WHERE tenant_id = ? GROUP BY month ORDER BY month DESC LIMIT 8`, [t]);
  const loanTypes = await q<Record<string, any>>("SELECT loan_type, COUNT(*) AS n FROM gn_applicants WHERE tenant_id = ? AND loan_type IS NOT NULL GROUP BY loan_type ORDER BY n DESC", [t]);
  res.json({ funnel, byLender, byProduct, byPartner, revenue, trend: trend.reverse(), loanTypes });
}));
