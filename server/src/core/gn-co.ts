import { q, q1, run } from "../db/connection.js";
import { audit } from "./audit.js";
import { computeCommission, effectiveRate, gnNotify, gnSettings, gnStatusGroup, gnStatusLabel, gnTimeline, gnRef } from "./gn.js";

/* ================= helpers ================= */

export function safeJson(v: string | null | undefined, dflt: any): any {
  try { const p = JSON.parse(v ?? ""); return p ?? dflt; } catch { return dflt; }
}

export async function applicantRef(tenantId: number) {
  const year = new Date().getFullYear();
  const n = ((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM gn_applicants WHERE tenant_id = ?", [tenantId]))?.n ?? 0) + 1;
  return `GN-APL-${year}-${String(10000 + n)}`;
}

export async function aplEvent(tenantId: number, applicantId: number, event: string, note: string | null, actor: number | null) {
  await run("INSERT INTO gn_applicant_events (tenant_id, applicant_id, event, note, actor) VALUES (?, ?, ?, ?, ?)", [tenantId, applicantId, event, note, actor]);
}

export function maskPan(pan: string | null | undefined): string {
  if (!pan || pan.length < 4) return "—";
  return `${pan.slice(0, 2)}XXXX${pan.slice(-2)}`;
}

/** Normalize an Indian mobile number: strips +91 or a 12-digit 91 prefix, keeps 10-digit numbers intact. */
export function normMobile(m: any): string {
  let s = String(m ?? "").replace(/[\s-]/g, "");
  if (s.startsWith("+91")) s = s.slice(3);
  else if (s.startsWith("91") && s.length === 12) s = s.slice(2);
  return s;
}

/* ================= OTP (demo) ================= */

export const DEMO_OTP = "123456";

export async function sendOtp(tenantId: number, applicantId: number, userId: number) {
  await run("UPDATE gn_applicants SET otp_status = 'sent', updated_at = datetime('now') WHERE id = ?", [applicantId]);
  await aplEvent(tenantId, applicantId, "OTP SENT", "Demo OTP 123456 (sandbox — no real SMS)", userId);
  return { otp: DEMO_OTP, demo: true };
}

export async function verifyOtp(tenantId: number, applicantId: number, otp: string, userId: number) {
  if (otp !== DEMO_OTP) return { ok: false, error: "Invalid OTP — demo OTP is 123456" };
  await run("UPDATE gn_applicants SET otp_status = 'verified', updated_at = datetime('now') WHERE id = ?", [applicantId]);
  await aplEvent(tenantId, applicantId, "OTP VERIFIED", "Mobile verified (demo)", userId);
  return { ok: true };
}

/* ================= Consent ================= */

export async function grantConsent(tenantId: number, applicantId: number, purpose: string, userId: number) {
  const version = "1.0";
  await run(
    "INSERT INTO gn_consents (tenant_id, applicant_id, purpose, status, version, source, received_at) VALUES (?, ?, ?, 'received', ?, 'command_center', datetime('now'))",
    [tenantId, applicantId, purpose, version]
  );
  await run("UPDATE gn_applicants SET consent_status = 'received', updated_at = datetime('now') WHERE id = ?", [applicantId]);
  await aplEvent(tenantId, applicantId, "CONSENT RECEIVED", `Consent v${version} — ${purpose}`, userId);
}

/* ================= KYC (demo provider) ================= */

export const KYC_TYPES = [
  { type: "mobile", label: "Mobile" },
  { type: "pan", label: "PAN" },
  { type: "identity", label: "Identity" },
  { type: "address", label: "Address" },
  { type: "bank", label: "Bank Account" }
];

export async function runKyc(tenantId: number, applicantId: number, userId: number, opts: { fail?: boolean } = {}) {
  const a = await q1<Record<string, any>>("SELECT * FROM gn_applicants WHERE id = ? AND tenant_id = ?", [applicantId, tenantId]);
  if (!a) throw new Error("Applicant not found");
  const seq = ["mobile", "pan", "identity", "address", "bank"];
  for (const [i, t] of seq.entries()) {
    const failed = opts.fail && i === 2; // identity check fails in demo fail mode
    const ref = `KYC-DEMO-${String(100000 + Math.floor(Math.random() * 900000))}`;
    await run(
      "INSERT INTO gn_kyc (tenant_id, applicant_id, kyc_type, provider, status, reference, verified_at) VALUES (?, ?, ?, 'Demo KYC Provider', ?, ?, ?)",
      [tenantId, applicantId, t, failed ? "failed" : "verified", ref, failed ? null : new Date().toISOString()]
    );
  }
  const status = opts.fail ? "failed" : "completed";
  await run("UPDATE gn_applicants SET kyc_status = ?, updated_at = datetime('now') WHERE id = ?", [status, applicantId]);
  await aplEvent(tenantId, applicantId, opts.fail ? "KYC FAILED" : "KYC COMPLETED", opts.fail ? "Identity verification failed (demo)" : "PAN / Identity / Address / Bank verified (demo provider)", userId);
  return status;
}

/* ================= Credit (demo provider) ================= */

export async function runCredit(tenantId: number, applicantId: number, userId: number, scoreOverride?: number) {
  const a = await q1<Record<string, any>>("SELECT * FROM gn_applicants WHERE id = ? AND tenant_id = ?", [applicantId, tenantId]);
  if (!a) throw new Error("Applicant not found");
  const seed = ((a.id ?? 0) * 2654435761) % 1000;
  const score = scoreOverride ?? (600 + (seed % 200)); // 600–799 demo score
  const ref = `CR-DEMO-${String(100000 + Math.floor(Math.random() * 900000))}`;
  await run(
    `INSERT INTO gn_credit_profiles (tenant_id, applicant_id, provider, score, active_accounts, closed_accounts, enquiries_6m,
       total_outstanding, total_sanctioned, overdue_amount, dpd, utilization_pct, status, reference)
     VALUES (?, ?, 'Demo Credit Provider', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
    [tenantId, applicantId, score, 2 + (seed % 6), 1 + (seed % 3), seed % 5,
      (a.existing_emi ?? 0) * 36, (a.loan_amount ?? 0) + (a.existing_emi ?? 0) * 60,
      seed % 3 > 1 ? 0 : 15000 + (seed % 90000), seed % 3 > 1 ? 0 : seed % 30, Math.round((seed % 40) + 10), ref]
  );
  await run("UPDATE gn_applicants SET credit_status = 'completed', credit_score = ?, updated_at = datetime('now') WHERE id = ?", [score, applicantId]);
  await aplEvent(tenantId, applicantId, "CREDIT PROFILE FETCHED", `Demo credit score ${score} — DEMO CREDIT DATA`, userId);
  return await q1<Record<string, any>>("SELECT * FROM gn_credit_profiles WHERE applicant_id = ? ORDER BY id DESC LIMIT 1", [applicantId])!;
}

/* ================= Matching engine ================= */

export interface MatchOut {
  lender_id: number | null;
  product_id: number | null;
  scheme_id: number;
  lender_name: string;
  product_name: string;
  scheme_name: string;
  category: string;
  min_amount: number | null;
  max_amount: number | null;
  roi: string | null;
  tenure: string | null;
  processing_fee: string | null;
  score: number;
  status: "eligible" | "maybe" | "not_eligible";
  reasons: string[];
  commission_pct: number;
}

/** Score one scheme against an applicant profile. Returns {score, status, reasons}. */
export function scoreScheme(s: Record<string, any>, a: Record<string, any>): { score: number; status: "eligible" | "maybe" | "not_eligible"; reasons: string[] } {
  const reasons: string[] = [];
  const lp = safeJson(s.loan_params, {});
  const el = safeJson(s.eligibility, {});
  const states = safeJson(s.states, []);
  const programs = safeJson(s.programs, []);
  const amount = a.loan_amount ?? 0;
  const tenure = a.tenure ?? null;
  const age = ageOf(a.dob);
  const income = a.monthly_income ?? null;
  const turnover = a.annual_turnover ?? null;
  const vintage = a.business_vintage ?? null;
  const credit = a.credit_score ?? null;
  const state = a.state ?? null;
  const propertyType = a.property_type ?? null;

  const weights: [string, number][] = [
    ["category", 12], ["amount", 18], ["tenure", 8], ["age", 10], ["income", 20], ["vintage", 10], ["credit", 15], ["geo", 5], ["property", 2]
  ];
  const w = Object.fromEntries(weights);
  let score = 100;
  const fail = (k: string, msg: string) => { score -= w[k]; reasons.push(msg); };

  const loanType = (a.loan_type ?? "").toLowerCase();
  const cat = (s.product_category ?? "").toLowerCase();
  const prodName = (s.product_name ?? "").toLowerCase();
  if (loanType && cat && !cat.includes(loanType) && !prodName.includes(loanType)) fail("category", `Category ${s.product_category} ≠ ${a.loan_type}`);

  if (lp.min_amount && amount && amount < lp.min_amount) fail("amount", `Amount below ₹${lp.min_amount.toLocaleString("en-IN")}`);
  if (lp.max_amount && amount && amount > lp.max_amount) fail("amount", `Amount above ₹${lp.max_amount.toLocaleString("en-IN")}`);
  if (tenure && lp.min_tenure && tenure < lp.min_tenure) fail("tenure", `Tenure below ${lp.min_tenure} mo`);
  if (tenure && lp.max_tenure && tenure > lp.max_tenure) fail("tenure", `Tenure above ${lp.max_tenure} mo`);
  if (age != null && el.min_age && age < el.min_age) fail("age", `Age ${age} below ${el.min_age}`);
  if (age != null && el.max_age && age > el.max_age) fail("age", `Age ${age} above ${el.max_age}`);
  if (income != null && el.min_income && income < el.min_income) fail("income", `Income below ₹${el.min_income.toLocaleString("en-IN")}/mo`);
  if (turnover != null && el.min_turnover && turnover < el.min_turnover) fail("income", `Turnover below ₹${el.min_turnover.toLocaleString("en-IN")}`);
  if (vintage != null && el.min_vintage && vintage < el.min_vintage) fail("vintage", `Vintage below ${el.min_vintage} yrs`);
  if (credit != null && el.min_credit_score && credit < el.min_credit_score) fail("credit", `Credit score ${credit} below ${el.min_credit_score}`);
  if (states.length && state && !states.includes(state) && !states.includes("All India")) fail("geo", `Not offered in ${state}`);
  if (propertyType && el.property_types?.length && !el.property_types.includes(propertyType)) fail("property", `Property type ${propertyType} not covered`);

  const status: "eligible" | "maybe" | "not_eligible" = reasons.length === 0 ? "eligible" : reasons.some((r) => /below|above|≠|not offered|not covered|mismatch/.test(r)) ? "not_eligible" : "maybe";
  return { score: Math.max(0, Math.round(score)), status, reasons };
}

export async function matchApplicant(tenantId: number, applicant: Record<string, any>) {
  const schemes = await q<Record<string, any>>(
    `SELECT s.*, l.name AS lender_name, l.api_status AS lender_api_status, p.name AS product_name, p.category AS product_category
     FROM gn_schemes s JOIN gn_lenders l ON l.id = s.lender_id LEFT JOIN gn_products p ON p.id = s.product_id
     WHERE s.tenant_id = ? AND s.status = 'active'`, [tenantId]);
  const out: MatchOut[] = [];
  for (const s of schemes) {
    const { score, status, reasons } = scoreScheme(s, applicant);
    const lp = safeJson(s.loan_params, {});
    const el = safeJson(s.eligibility, {});
    const settings = await gnSettings(tenantId);
    const payout = s.commission_pct ?? s.rate ?? 0;
    out.push({
      lender_id: s.lender_id ?? null,
      product_id: s.product_id ?? null,
      scheme_id: s.id,
      lender_name: s.lender_name ?? "—",
      product_name: s.product_name ?? s.product_category ?? "—",
      scheme_name: s.name,
      category: s.product_category ?? "",
      min_amount: lp.min_amount ?? null,
      max_amount: lp.max_amount ?? null,
      roi: lp.roi_min != null && lp.roi_max != null ? `${lp.roi_min}–${lp.roi_max}%` : null,
      tenure: lp.min_tenure != null && lp.max_tenure != null ? `${lp.min_tenure}–${lp.max_tenure} mo` : null,
      processing_fee: lp.processing_fee_pct != null ? `${lp.processing_fee_pct}%` : null,
      score,
      status,
      reasons,
      commission_pct: payout
    });
  }
  const rank = { eligible: 0, maybe: 1, not_eligible: 2 };
  out.sort((a, b) => rank[a.status] - rank[b.status] || b.score - a.score);
  return out.slice(0, 8);
}

export async function storeMatches(tenantId: number, applicantId: number, matches: MatchOut[]) {
  const ids: number[] = [];
  for (const m of matches) {
    const id = (await run(
      `INSERT INTO gn_lender_matches (tenant_id, applicant_id, lender_id, product_id, scheme_id, lender_name, product_name, scheme_name,
         category, min_amount, max_amount, roi, tenure, score, status, reasons, commission_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, applicantId, m.lender_id, m.product_id, m.scheme_id, m.lender_name, m.product_name, m.scheme_name,
        m.category, m.min_amount, m.max_amount, m.roi, m.tenure, m.score, m.status, JSON.stringify(m.reasons), m.commission_pct]
    )).lastId;
    ids.push(id);
  }
  return ids;
}

export function ageOf(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
}

/* ================= Documents ================= */

export const DOC_TEMPLATES: Record<string, { code: string; name: string }[]> = {
  "Business Loan": [
    { code: "pan", name: "PAN Card" }, { code: "gst", name: "GST Registration" }, { code: "udyam", name: "Udyam Certificate" },
    { code: "bank_statement", name: "Bank Statement (12 months)" }, { code: "itr", name: "ITR (2 years)" }, { code: "business_proof", name: "Business Proof" }
  ],
  "Personal Loan": [
    { code: "pan", name: "PAN Card" }, { code: "address", name: "Address Proof / OVD" },
    { code: "bank_statement", name: "Bank Statement (6 months)" }, { code: "salary_slip", name: "Salary Slip (3 months)" }
  ],
  "Home Loan": [
    { code: "pan", name: "PAN Card" }, { code: "address", name: "Address Proof" }, { code: "income_proof", name: "Income Proof" },
    { code: "bank_statement", name: "Bank Statement (6 months)" }, { code: "property", name: "Property Documents" }, { code: "stamp", name: "Stamp Duty / Agreement" }
  ],
  "Loan Against Property": [
    { code: "pan", name: "PAN Card" }, { code: "business_proof", name: "Business Proof" }, { code: "property", name: "Property Title Deed" },
    { code: "bank_statement", name: "Bank Statement (12 months)" }, { code: "itr", name: "ITR (2 years)" }
  ],
  "Vehicle Loan": [
    { code: "pan", name: "PAN Card" }, { code: "address", name: "Address Proof" }, { code: "bank_statement", name: "Bank Statement (6 months)" },
    { code: "business_proof", name: "Business Proof" }, { code: "invoice", name: "Vehicle Invoice / Quotation" }
  ],
  "Equipment Loan": [
    { code: "pan", name: "PAN Card" }, { code: "address", name: "Address Proof" }, { code: "bank_statement", name: "Bank Statement (6 months)" },
    { code: "business_proof", name: "Business Proof" }, { code: "invoice", name: "Equipment Quotation / Invoice" }
  ],
  "Auto Loan": [
    { code: "pan", name: "PAN Card" }, { code: "address", name: "Address Proof" }, { code: "bank_statement", name: "Bank Statement (6 months)" },
    { code: "business_proof", name: "Business Proof" }, { code: "invoice", name: "Vehicle Invoice" }
  ],
  "Working Capital": [
    { code: "pan", name: "PAN Card" }, { code: "gst", name: "GST Registration" }, { code: "bank_statement", name: "Bank Statement (12 months)" },
    { code: "itr", name: "ITR (2 years)" }, { code: "business_proof", name: "Business Proof" }
  ]
};

export function requiredDocsFor(category: string | null | undefined, productRequired: string[] | null): { code: string; name: string }[] {
  if (productRequired && productRequired.length) return productRequired.map((r) => ({ code: r, name: r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) }));
  const key = Object.keys(DOC_TEMPLATES).find((k) => (category ?? "").toLowerCase().includes(k.toLowerCase())) ?? "Business Loan";
  return DOC_TEMPLATES[key] ?? DOC_TEMPLATES["Business Loan"];
}

/* ================= Pipeline ================= */

export interface PipelineResult {
  appId: number;
  ref: string;
  status: string;
  applicantStatus: string;
}

export async function createApplication(t: number, a: Record<string, any>, opts: { match_id?: number; lender_id?: number; product_id?: number; scheme_id?: number; amount?: number; tenure?: number; source?: string }, userId: number) {
  const match = opts.match_id ? await q1<Record<string, any>>("SELECT * FROM gn_lender_matches WHERE id = ? AND tenant_id = ? AND applicant_id = ?", [opts.match_id, t, a.id]) : null;
  if (!match && !opts.lender_id) throw new Error("Select a lender match before creating the application");
  const ref = await gnRef(t);
  const amount = opts.amount ?? a.loan_amount ?? match?.max_amount ?? 100000;
  const tenure = opts.tenure ?? a.tenure ?? 12;
  const id = (await run(
    `INSERT INTO gn_applications (tenant_id, ref, applicant_id, name, mobile, email, city, state, employment_type, monthly_income,
       business_turnover, business_vintage, loan_type, product_id, lender_id, scheme_id, dsa_code, partner_id, assigned_to,
       amount, tenure, purpose, source, status, stage, commission_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'app_created', 'application', ?)`,
    [t, ref, a.id, a.name, a.mobile ?? null, a.email ?? null, a.city ?? null, a.state ?? null, a.employment_type ?? null,
      a.monthly_income ?? null, a.annual_turnover ?? null, a.business_vintage ?? null, a.loan_type ?? null,
      match?.product_id ?? opts.product_id ?? null, match?.lender_id ?? opts.lender_id ?? null, match?.scheme_id ?? opts.scheme_id ?? null,
      a.dsa_code ?? null, a.partner_id ?? null, a.assigned_to ?? null, amount, tenure, a.purpose ?? null,
      opts.source ?? a.source ?? "command_center", match?.commission_pct ?? 0]
  )).lastId;
  if (match) await run("UPDATE gn_lender_matches SET selected = 1 WHERE id = ?", [match.id]);
  const docs = requiredDocsFor(match?.category ?? a.loan_type, null);
  for (const d of docs) {
    await run("INSERT INTO gn_documents (tenant_id, entity_type, entity_id, doc_type, name, status) VALUES (?, 'application', ?, ?, ?, 'pending')", [t, id, d.code, d.name]);
  }
  await gnTimeline(t, id, "APPLICATION CREATED", `Application ${ref} created via command center`, userId);
  await aplEvent(t, a.id, "APPLICATION CREATED", ref, userId);
  await run("UPDATE gn_applicants SET app_status = 'created', loan_amount = ?, tenure = ?, updated_at = datetime('now') WHERE id = ?", [amount, tenure, a.id]);
  return id;
}

export async function setAppStatus(t: number, appId: number, status: string, userId: number, note?: string | null, amount?: number) {
  const app = await q1<Record<string, any>>("SELECT * FROM gn_applications WHERE id = ? AND tenant_id = ?", [appId, t]);
  if (!app) throw new Error("Application not found");
  const sets: string[] = ["status = ?", "stage = ?", "updated_at = datetime('now')"];
  const params: unknown[] = [status, gnStatusGroup(status)];
  if (status === "submitted") { sets.push("submitted_at = datetime('now')"); }
  if (status === "approved" || status === "sanction_generated") { sets.push("sanctioned_at = datetime('now')"); }  if (status.startsWith("disb_") || status === "disb_confirmed") {
    const amt = amount ?? (app.disbursed_amount || app.amount);
    sets.push("disbursed_amount = ?", "disbursed_at = datetime('now')");
    params.push(amt);
  }
  params.push(appId);
  await run(`UPDATE gn_applications SET ${sets.join(", ")} WHERE id = ?`, params);
  await gnTimeline(t, appId, gnStatusLabel(status).toUpperCase(), note ?? `Status → ${gnStatusLabel(status)}`, userId);
  // Commission on full disbursement
  if ((status === "disb_fully" || status === "disb_confirmed") && app.disbursed_amount > 0 && app.commission_gross === 0) {
    const next = await q1<Record<string, any>>(
      `SELECT a.*, s.rate AS scheme_rate, p.payout_pct AS product_payout FROM gn_applications a
       LEFT JOIN gn_schemes s ON s.id = a.scheme_id LEFT JOIN gn_products p ON p.id = a.product_id WHERE a.id = ?`, [appId])!;
    const rate = effectiveRate(next);
    const settings = await gnSettings(t);
    const c = computeCommission(next.disbursed_amount, rate, settings);
    await run("UPDATE gn_applications SET commission_rate = ?, commission_gross = ?, commission_tds = ?, commission_net = ? WHERE id = ?", [rate, c.gross, c.tds, c.net, appId]);
    await run("INSERT INTO gn_commissions (tenant_id, app_id, lender_id, scheme_id, disbursed_amount, rate, gross, gst, tds, net, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'earned')",
      [t, appId, next.lender_id, next.scheme_id, next.disbursed_amount, rate, c.gross, c.gst, c.tds, c.net]);
    await gnTimeline(t, appId, "COMMISSION CALCULATED", `₹${c.gross.toLocaleString("en-IN")} gross at ${rate}%`, userId);
  }
  return await q1<Record<string, any>>("SELECT * FROM gn_applications WHERE id = ?", [appId])!;
}

export async function submitApplication(t: number, appId: number, userId: number) {
  const app = await q1<Record<string, any>>("SELECT * FROM gn_applications WHERE id = ? AND tenant_id = ?", [appId, t]);
  if (!app) throw new Error("Application not found");
  if (!app.lender_id) throw new Error("Select a lender before submitting");
  const missing = await q<{ doc_type: string }>("SELECT doc_type FROM gn_documents WHERE tenant_id = ? AND entity_type = 'application' AND entity_id = ? AND status NOT IN ('uploaded', 'verified', 'not_required')", [t, appId]);
  if (missing.length) throw new Error(`Missing documents: ${missing.map((m) => m.doc_type).join(", ")}`);
  const next = await setAppStatus(t, appId, "submitted", userId, `Submitted to lender — LND-DEMO-${String(100000 + Math.floor(Math.random() * 900000))}`);
  if (app.applicant_id) await run("UPDATE gn_applicants SET app_status = 'submitted', updated_at = datetime('now') WHERE id = ?", [app.applicant_id]);
  await gnNotify(t, app.assigned_to, "Application submitted", `${app.ref} submitted to lender for underwriting`);
  return next;
}

/** Walk an application through lender simulation steps. */
export async function simulateLender(t: number, appId: number, action: "underwrite" | "approve" | "reject" | "sanction" | "agreement" | "disburse" | "fund" | "confirm" | "payout", userId: number, opts: { amount?: number; utr?: string } = {}) {
  const app = await q1<Record<string, any>>("SELECT * FROM gn_applications WHERE id = ? AND tenant_id = ?", [appId, t]);
  if (!app) throw new Error("Application not found");
  const applicant = await q1<Record<string, any>>("SELECT * FROM gn_applicants WHERE id = ?", [app.applicant_id ?? null]);
  const amount = opts.amount ?? app.amount;
  let next: Record<string, any> = app;
  switch (action) {
    case "underwrite":
      next = await setAppStatus(t, appId, "uw", userId, "Mock lender began underwriting");
      break;
    case "approve":
      next = await setAppStatus(t, appId, "approved", userId, `Sanction approved — SAN-DEMO-${String(100000 + Math.floor(Math.random() * 900000))}`);
      if (applicant) {
        await run("INSERT INTO gn_sanctions (tenant_id, applicant_id, app_id, lender_id, sanctioned_amount, tenure, roi, reference, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')",
          [t, applicant.id, appId, app.lender_id, amount, app.tenure, app.roi ?? null, `SAN-DEMO-${String(100000 + Math.floor(Math.random() * 900000))}`]);
      }
      break;
    case "reject":
      next = await setAppStatus(t, appId, "rejected", userId, "Mock lender rejected the application");
      break;
    case "sanction":
      next = await setAppStatus(t, appId, "sanction_generated", userId, "Sanction letter generated");
      break;
    case "agreement":
      next = await setAppStatus(t, appId, "agreement_completed", userId, "Agreement & eSign completed (demo)");
      if (applicant) {
        await run("INSERT INTO gn_agreements (tenant_id, applicant_id, app_id, status, reference, completed_at) VALUES (?, ?, ?, 'completed', ?, datetime('now'))",
          [t, applicant.id, appId, `AGR-DEMO-${String(100000 + Math.floor(Math.random() * 900000))}`]);
      }
      break;
    case "disburse":
      next = await setAppStatus(t, appId, "disb_initiated", userId, `Lender initiated disbursement of ₹${amount.toLocaleString("en-IN")}`, amount);
      if (applicant) {
        await run("INSERT INTO gn_disbursements (tenant_id, applicant_id, app_id, lender_id, amount, bank_account, reference, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'initiated')",
          [t, applicant.id, appId, app.lender_id, amount, maskAccount(applicant.bank_account), `DISB-DEMO-${String(100000 + Math.floor(Math.random() * 900000))}`]);
      }
      break;
    case "fund":
      next = await setAppStatus(t, appId, "disb_fully", userId, `₹${amount.toLocaleString("en-IN")} credited to borrower's bank account`);
      break;
    case "confirm":
      next = await setAppStatus(t, appId, "disb_confirmed", userId, "Lender confirmed disbursement via webhook");
      await run("UPDATE gn_disbursements SET status = 'completed', completed_at = datetime('now'), utr = ? WHERE app_id = ? AND status = 'initiated'", [opts.utr ?? `UTR-DEMO-${String(100000000 + Math.floor(Math.random() * 900000000))}`, appId]);
      break;
    case "payout": {
      next = await setAppStatus(t, appId, "crm_updated", userId, "CRM updated; payout calculated");
      const row = await q1<Record<string, any>>(
        `SELECT a.*, s.rate AS scheme_rate, p.payout_pct AS product_payout, c.id AS commission_id, c.gross AS comm_gross, c.gst AS comm_gst, c.tds AS comm_tds, c.net AS comm_net
         FROM gn_applications a LEFT JOIN gn_schemes s ON s.id = a.scheme_id LEFT JOIN gn_products p ON p.id = a.product_id
         LEFT JOIN gn_commissions c ON c.app_id = a.id
         WHERE a.id = ?`, [appId])!;
      const rate = effectiveRate(row);
      const settings = await gnSettings(t);
      const c = computeCommission(row.disbursed_amount, rate, settings);
      const partnerSplit = settings.partner_split_pct ?? 60;
      if (applicant) {
        await run(
          `INSERT INTO gn_payouts (tenant_id, applicant_id, app_id, disbursed_amount, rate, gross, gst, tds, net, partner_split_pct, partner_share, gn_share, status, received_at, utr)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', datetime('now'), ?)`,
          [t, applicant.id, appId, row.disbursed_amount, rate, c.gross, c.gst, c.tds, c.net, partnerSplit,
            Math.round((c.net * partnerSplit) / 100), c.net - Math.round((c.net * partnerSplit) / 100),
            opts.utr ?? `UTR-DEMO-${String(100000000 + Math.floor(Math.random() * 900000000))}`]
        );
      }
      await run("UPDATE gn_commissions SET status = 'received', received_at = datetime('now') WHERE app_id = ? AND status = 'earned'", [appId]);
      await run("UPDATE gn_applications SET status = 'payout_received', stage = 'completed', updated_at = datetime('now') WHERE id = ?", [appId]);
      next = await q1<Record<string, any>>("SELECT * FROM gn_applications WHERE id = ?", [appId])!;
      await gnTimeline(t, appId, "PAYOUT RECEIVED", `₹${c.net.toLocaleString("en-IN")} net payout tracked`, userId);
      break;
    }
  }
  if (applicant) {
    const map: Record<string, string> = {
      uw: "uw", approved: "approved", rejected: "rejected", sanction_generated: "sanctioned", agreement_completed: "agreement",
      disb_initiated: "disb_initiated", disb_fully: "disbursed", disb_confirmed: "disbursed", crm_updated: "payout", payout_received: "payout"
    };
    const s = map[next.status] ?? "created";
    await run("UPDATE gn_applicants SET app_status = ?, updated_at = datetime('now') WHERE id = ?", [s, applicant.id]);
  }
  return next;
}

function maskAccount(acc: string | null | undefined): string {
  if (!acc || acc.length < 4) return "XXXXXX0000";
  return "XXXXXX" + acc.slice(-4);
}

/** Full automated journey: KYC → credit → match → application → submit → approve → agreement → disburse → payout. */
export async function runFullPipeline(t: number, applicantId: number, userId: number, opts: { match_id?: number; force?: boolean } = {}) {
  const a = await q1<Record<string, any>>("SELECT * FROM gn_applicants WHERE id = ? AND tenant_id = ?", [applicantId, t]);
  if (!a) throw new Error("Applicant not found");
  if (a.otp_status !== "verified" && !opts.force) {
    await run("UPDATE gn_applicants SET otp_status = 'verified' WHERE id = ?", [applicantId]);
  }
  if (a.consent_status !== "received" && !opts.force) await grantConsent(t, applicantId, "Loan application, KYC, credit information & lender sharing", userId);
  await runKyc(t, applicantId, userId);
  await runCredit(t, applicantId, userId);
  const matches = await matchApplicant(t, a);
  if (!matches.length) {
    await run("UPDATE gn_applicants SET match_status = 'no_match', app_status = 'created', updated_at = datetime('now') WHERE id = ?", [applicantId]);
    await aplEvent(t, applicantId, "NO MATCH", "No eligible lender product found", userId);
    throw new Error("No eligible lender match — applicant requires manual review");
  }
  const best = opts.match_id ? await q1<Record<string, any>>("SELECT * FROM gn_lender_matches WHERE id = ? AND tenant_id = ?", [opts.match_id, t]) : null;
  let matchId = opts.match_id ?? null;
  if (!matchId) {
    const ids = await storeMatches(t, applicantId, matches);
    matchId = ids[matches.findIndex((m) => m.status === "eligible") >= 0 ? matches.findIndex((m) => m.status === "eligible") : 0];
  }
  const match = best ?? await q1<Record<string, any>>("SELECT * FROM gn_lender_matches WHERE id = ?", [matchId])!;
  await run("UPDATE gn_applicants SET match_status = 'completed', app_status = 'created', updated_at = datetime('now') WHERE id = ?", [applicantId]);
  const appId = await createApplication(t, { ...a, id: applicantId }, { match_id: matchId }, userId);
  // demo: auto-verify documents
  await run("UPDATE gn_documents SET status = 'verified', verified_at = datetime('now') WHERE tenant_id = ? AND entity_type = 'application' AND entity_id = ?", [t, appId]);
  await submitApplication(t, appId, userId);
  await simulateLender(t, appId, "underwrite", userId);
  await simulateLender(t, appId, "approve", userId, { amount: a.loan_amount ?? match.max_amount ?? 0 });
  await simulateLender(t, appId, "agreement", userId);
  await simulateLender(t, appId, "disburse", userId, { amount: a.loan_amount ?? match.max_amount ?? 0 });
  await simulateLender(t, appId, "fund", userId, { amount: a.loan_amount ?? match.max_amount ?? 0 });
  await simulateLender(t, appId, "confirm", userId);
  await simulateLender(t, appId, "payout", userId);
  const app = await q1<Record<string, any>>("SELECT * FROM gn_applications WHERE id = ?", [appId])!;
  await run("UPDATE gn_applicants SET doc_status = 'completed', app_status = 'payout', updated_at = datetime('now') WHERE id = ?", [applicantId]);
  return { appId, ref: app.ref, status: app.status, applicantStatus: "payout" };
}

/* ================= Demo scenario ================= */

/** The reference demo story — Rahul Sharma, ₹25L business loan, full journey. */
export async function runDemoScenario(tenantId: number, userId: number) {
  const name = "Rahul Sharma";
  let a = await q1<Record<string, any>>("SELECT * FROM gn_applicants WHERE tenant_id = ? AND name = ? AND is_demo = 1 ORDER BY id DESC LIMIT 1", [tenantId, name]);
  if (a) {
    // Reset for a fresh run
    await run("DELETE FROM gn_applicant_events WHERE applicant_id = ?", [a.id]);
    await run("DELETE FROM gn_consents WHERE applicant_id = ?", [a.id]);
    await run("DELETE FROM gn_kyc WHERE applicant_id = ?", [a.id]);
    await run("DELETE FROM gn_credit_profiles WHERE applicant_id = ?", [a.id]);
    await run("DELETE FROM gn_lender_matches WHERE applicant_id = ?", [a.id]);
    await run("DELETE FROM gn_sanctions WHERE applicant_id = ?", [a.id]);
    await run("DELETE FROM gn_agreements WHERE applicant_id = ?", [a.id]);
    await run("DELETE FROM gn_disbursements WHERE applicant_id = ?", [a.id]);
    await run("DELETE FROM gn_payouts WHERE applicant_id = ?", [a.id]);
  } else {
    const ref = await applicantRef(tenantId);
    const id = (await run(
      `INSERT INTO gn_applicants (tenant_id, ref, name, mobile, email, pan, dob, city, state, applicant_type, employment_type,
         business_name, business_type, business_vintage, industry, annual_turnover, monthly_income, loan_type, loan_amount, tenure, purpose,
         bank_name, bank_account, source, is_demo, otp_status, consent_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo', 1, 'verified', 'received')`,
      [tenantId, ref, name, "9876543210", "rahul.sharma@example.in", "BHRPS1234F", "1994-03-12", "Ahmedabad", "Gujarat", "Individual", "Self-employed",
        "ABC Engineering Works", "Proprietorship", 5, "Engineering", 24000000, 200000, "Business Loan", 2500000, 48, "Working capital expansion",
        "HDFC Bank", "50100123456789"]
    )).lastId;
    a = await q1<Record<string, any>>("SELECT * FROM gn_applicants WHERE id = ?", [id])!;
  }
  // Override the demo credit score to the reference 764
  await run("UPDATE gn_applicants SET credit_score = 764 WHERE id = ?", [a!.id]);
  const res = await runFullPipeline(tenantId, a!.id, userId, { force: true });
  return { applicantId: a!.id, appId: res.appId, ref: res.ref };
}

/* ================= Lender webhooks (shared) ================= */

export const WEBHOOK_EVENTS: Record<string, { status: string; event: string; note: string }> = {
  APPLICATION_SUBMITTED: { status: "submitted", event: "APPLICATION SUBMITTED", note: "Webhook: submitted to lender" },
  UNDERWRITING_STARTED: { status: "uw", event: "UNDERWRITING STARTED", note: "Webhook: underwriting started" },
  DOCUMENT_REQUIRED: { status: "addl_docs", event: "ADDITIONAL DOCUMENTS REQUIRED", note: "Webhook: lender requested more documents" },
  APPROVED: { status: "approved", event: "APPROVED", note: "Webhook: lender approved" },
  REJECTED: { status: "rejected", event: "REJECTED", note: "Webhook: lender rejected" },
  AGREEMENT_COMPLETED: { status: "agreement_completed", event: "AGREEMENT COMPLETED", note: "Webhook: agreement/eSign complete" },
  DISBURSEMENT_INITIATED: { status: "disb_initiated", event: "DISBURSEMENT INITIATED", note: "Webhook: lender initiated disbursement" },
  DISBURSEMENT_COMPLETED: { status: "disb_confirmed", event: "DISBURSEMENT COMPLETED", note: "Webhook: lender disbursed funds" },
  DISBURSEMENT_FAILED: { status: "disb_failed", event: "DISBURSEMENT FAILED", note: "Webhook: lender disbursement failed" },
  PAYOUT_RECEIVED: { status: "payout_received", event: "PAYOUT RECEIVED", note: "Webhook: commission payout received" }
};

export async function applyLenderWebhook(tenantId: number, appId: number, event: string, amount?: number, utr?: string) {
  const tr = WEBHOOK_EVENTS[event];
  if (!tr) return { ok: false, error: `Unknown event ${event}` };
  const app = await q1<Record<string, any>>(
    `SELECT a.*, s.rate AS scheme_rate, p.payout_pct AS product_payout FROM gn_applications a
     LEFT JOIN gn_schemes s ON s.id = a.scheme_id LEFT JOIN gn_products p ON p.id = a.product_id WHERE a.id = ? AND a.tenant_id = ?`,
    [appId, tenantId]);
  if (!app) return { ok: false, error: "Application not found" };
  const dup = await q1<{ id: number }>("SELECT id FROM gn_application_timeline WHERE app_id = ? AND event = ?", [app.id, tr.event]);
  if (dup) return { ok: true, duplicate: true, status: app.status };
  const sets: string[] = ["status = ?", "stage = ?", "updated_at = datetime('now')"];
  const params: unknown[] = [tr.status, gnStatusGroup(tr.status)];
  if (event === "DISBURSEMENT_COMPLETED" && amount) {
    sets.push("disbursed_amount = ?", "disbursed_at = datetime('now')");
    params.push(amount);
  }
  params.push(app.id);
  await run(`UPDATE gn_applications SET ${sets.join(", ")} WHERE id = ?`, params);
  await gnTimeline(tenantId, app.id, tr.event, tr.note + (utr ? ` · UTR ${utr}` : ""), null);
  const applicant = await q1<Record<string, any>>("SELECT * FROM gn_applicants WHERE id = ?", [app.applicant_id ?? null]);
  if (event === "DISBURSEMENT_COMPLETED") {
    const next = await q1<Record<string, any>>("SELECT * FROM gn_applications WHERE id = ?", [app.id])!;
    if (next.disbursed_amount > 0 && next.commission_gross === 0) {
      const rate = effectiveRate(next);
      const settings = await gnSettings(tenantId);
      const c = computeCommission(next.disbursed_amount, rate, settings);
      await run("UPDATE gn_applications SET commission_rate = ?, commission_gross = ?, commission_tds = ?, commission_net = ? WHERE id = ?", [rate, c.gross, c.tds, c.net, app.id]);
      await run("INSERT INTO gn_commissions (tenant_id, app_id, lender_id, scheme_id, disbursed_amount, rate, gross, gst, tds, net, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'earned')",
        [tenantId, app.id, next.lender_id, next.scheme_id, next.disbursed_amount, rate, c.gross, c.gst, c.tds, c.net]);
    }
    if (applicant) await run("UPDATE gn_applicants SET app_status = 'disbursed', updated_at = datetime('now') WHERE id = ?", [applicant.id]);
  }
  if (event === "PAYOUT_RECEIVED") {
    await run("UPDATE gn_commissions SET status = 'received', received_at = datetime('now'), utr = ? WHERE app_id = ? AND status = 'earned'", [utr ?? null, app.id]);
    if (applicant) await run("UPDATE gn_applicants SET app_status = 'payout', updated_at = datetime('now') WHERE id = ?", [applicant.id]);
  }
  await gnNotify(tenantId, app.assigned_to, tr.event, `${app.ref} — ${tr.note}`);
  return { ok: true, status: tr.status };
}

/* ================= Bulk processing ================= */

export interface BulkRowOut {
  id: number;
  row_no: number;
  status: string;
  applicant_id: number | null;
  application_id: number | null;
  error: string | null;
}

/** Deterministic RNG (mulberry32) so demo runs are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function job(t: number, batchId: number, jobType: string, rowId: number | null, applicantId: number | null, appId: number | null, status: string, userId: number | null, error?: string | null, provider?: string | null) {
  await run(
    `INSERT INTO gn_bulk_jobs (tenant_id, batch_id, row_id, applicant_id, application_id, job_type, status, attempts, error, provider, request_id, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, datetime('now'), datetime('now'))`,
    [t, batchId, rowId, applicantId, appId, jobType, status, error ?? null, provider ?? null, `REQ-DEMO-${String(100000 + Math.floor(Math.random() * 900000))}`]
  );
}

export async function bulkError(t: number, batchId: number, rowId: number | null, category: string, message: string, recommendation: string) {
  await run("INSERT INTO gn_bulk_errors (tenant_id, batch_id, row_id, category, message, recommendation) VALUES (?, ?, ?, ?, ?, ?)", [t, batchId, rowId, category, message, recommendation]);
}

/**
 * Process every eligible row of a batch through the origination pipeline.
 * Demo-mode only: KYC/Credit/Lender outcomes are simulated (clearly labelled DEMO).
 */
export async function processBulkBatch(t: number, batchId: number, userId: number) {
  const batch = await q1<Record<string, any>>("SELECT * FROM gn_bulk_batches WHERE id = ? AND tenant_id = ?", [batchId, t]);
  if (!batch) throw new Error("Batch not found");
  if (batch.status === "cancelled") throw new Error("Batch is cancelled");
  await run("UPDATE gn_bulk_batches SET status = 'processing', updated_at = datetime('now') WHERE id = ?", [batchId]);
  const rows = await q<Record<string, any>>("SELECT * FROM gn_bulk_rows WHERE batch_id = ? AND status = 'valid' ORDER BY row_no", [batchId]);
  const rng = mulberry32(batchId * 1000003 + 17);
  const settings = await gnSettings(t);
  let created = 0, submitted = 0, approved = 0, disbursed = 0, disbursedAmount = 0, errors = 0;

  for (const row of rows) {
    const mapped = safeJson(row.mapped, {});
    try {
      const ref = await applicantRef(t);
      const a = mapped;
      const applicantId = (await run(
        `INSERT INTO gn_applicants (tenant_id, ref, name, mobile, email, pan, dob, gender, city, state, pincode, applicant_type,
           employment_type, employer, business_name, business_type, business_vintage, industry, monthly_income, annual_turnover, gst, udyam,
           existing_emi, loan_type, loan_amount, tenure, purpose, source, campaign, builder, oem, dsa_code, partner_id, batch_id, is_demo,
           otp_status, consent_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'verified', 'received')`,
        [t, ref, a.name, a.mobile ?? null, a.email ?? null, a.pan ?? null, a.dob ?? null, a.gender ?? null,
          a.city ?? null, a.state ?? null, a.pincode ?? null, a.applicant_type ?? "Individual",
          a.employment_type ?? null, a.company ?? null, a.business_name ?? null, a.business_type ?? null, a.business_vintage ?? null, a.industry ?? null,
          a.monthly_income ?? null, a.annual_turnover ?? null, a.gst ?? null, a.udyam ?? null,
          a.existing_emi ?? 0, a.loan_type ?? null, a.loan_amount ?? 0, a.tenure ?? 12, a.purpose ?? null,
          a.source ?? batch.source ?? "bulk", a.campaign ?? batch.description ?? null, a.builder ?? null, a.oem ?? null, a.dsa ?? null,
          null, batchId]
      )).lastId;
      created++;
      await run("UPDATE gn_bulk_rows SET status = 'applicant_created', applicant_id = ? WHERE id = ?", [applicantId, row.id]);
      await job(t, batchId, "applicant", row.id, applicantId, null, "completed", userId, null, "Demo Provider");
      await aplEvent(t, applicantId, "APPLICANT CREATED", `${ref} created from bulk batch ${batch.name}`, userId);

      // KYC (demo — 9% fail)
      if (rng() < 0.09) {
        await runKyc(t, applicantId, userId, { fail: true });
        await run("UPDATE gn_bulk_rows SET status = 'failed', error = 'KYC verification failed' WHERE id = ?", [row.id]);
        await bulkError(t, batchId, row.id, "kyc_failed", "KYC verification failed", "Request fresh KYC consent and re-run verification for this applicant");
        await job(t, batchId, "kyc", row.id, applicantId, null, "failed", userId, "Identity verification failed", "Demo KYC Provider");
        errors++;
        continue;
      }
      await runKyc(t, applicantId, userId);
      await job(t, batchId, "kyc", row.id, applicantId, null, "completed", userId, null, "Demo KYC Provider");

      await runCredit(t, applicantId, userId);
      await job(t, batchId, "credit", row.id, applicantId, null, "completed", userId, null, "Demo Credit Provider");

      // Match (demo — 10% no match)
      const matches = await matchApplicant(t, await q1("SELECT * FROM gn_applicants WHERE id = ?", [applicantId])!);
      if (!matches.length || rng() < 0.1) {
        await run("UPDATE gn_applicants SET match_status = 'no_match', app_status = 'submitted', updated_at = datetime('now') WHERE id = ?", [applicantId]);
        await run("UPDATE gn_bulk_rows SET status = 'failed', error = 'No eligible lender match' WHERE id = ?", [row.id]);
        await bulkError(t, batchId, row.id, "product_mismatch", "No eligible lender product match", "Review applicant profile or adjust loan requirement and re-run matching");
        await job(t, batchId, "match", row.id, applicantId, null, "failed", userId, "No match", "GN Matcher");
        errors++;
        continue;
      }
      await storeMatches(t, applicantId, matches);
      const best = matches.find((m) => m.status === "eligible") ?? matches[0];
      await run("UPDATE gn_applicants SET match_status = 'completed', app_status = 'created', updated_at = datetime('now') WHERE id = ?", [applicantId]);
      await job(t, batchId, "match", row.id, applicantId, null, "completed", userId, null, "GN Matcher");

      // Create application (92%)
      if (rng() < 0.08) {
        await run("UPDATE gn_bulk_rows SET status = 'failed', error = 'Application skipped — manual review' WHERE id = ?", [row.id]);
        await bulkError(t, batchId, row.id, "product_mismatch", "Application deferred for manual review", "Assign an officer to review and create the application manually");
        await job(t, batchId, "application", row.id, applicantId, null, "skipped", userId, "Manual review", null);
        errors++;
        continue;
      }
      const appId = await createApplication(t, await q1("SELECT * FROM gn_applicants WHERE id = ?", [applicantId])!, { lender_id: best.lender_id ?? undefined, product_id: best.product_id ?? undefined, scheme_id: best.scheme_id }, userId);
      await run("UPDATE gn_documents SET status = 'verified', verified_at = datetime('now') WHERE tenant_id = ? AND entity_type = 'application' AND entity_id = ?", [t, appId]);
      await run("UPDATE gn_bulk_rows SET status = 'app_created', application_id = ? WHERE id = ?", [appId, row.id]);
      await job(t, batchId, "application", row.id, applicantId, appId, "completed", userId, null, null);
      const appRef = (await q1<{ ref: string }>("SELECT ref FROM gn_applications WHERE id = ?", [appId]))!.ref;

      // Submit (95%)
      if (rng() < 0.05) {
        await run("UPDATE gn_bulk_rows SET status = 'failed', error = 'Submission pending consent' WHERE id = ?", [row.id]);
        await bulkError(t, batchId, row.id, "consent_missing", "Consent not yet received", "Send consent request to applicant to continue");
        await job(t, batchId, "submit", row.id, applicantId, appId, "failed", userId, "Consent missing", null);
        errors++;
        continue;
      }
      await submitApplication(t, appId, userId);
      submitted++;
      await run("UPDATE gn_bulk_rows SET status = 'submitted' WHERE id = ?", [row.id]);
      await job(t, batchId, "submit", row.id, applicantId, appId, "completed", userId, null, "Demo Lender");

      // Lender outcome: 64% approved, rest rejected
      if (rng() < 0.36) {
        await simulateLender(t, appId, "underwrite", userId);
        await simulateLender(t, appId, "reject", userId);
        await run("UPDATE gn_bulk_rows SET status = 'rejected' WHERE id = ?", [row.id]);
        await bulkError(t, batchId, row.id, "rejection", "Lender rejected the application (demo)", "Review lender feedback and resubmit to an alternative matched lender");
        await job(t, batchId, "underwrite", row.id, applicantId, appId, "completed", userId, null, "Demo Lender");
        await job(t, batchId, "approve", row.id, applicantId, appId, "failed", userId, "Rejected by lender", "Demo Lender");
        errors++;
        continue;
      }
      await simulateLender(t, appId, "underwrite", userId);
      await simulateLender(t, appId, "approve", userId, { amount: a.loan_amount ?? 0 });
      approved++;
      await run("UPDATE gn_bulk_rows SET status = 'approved' WHERE id = ?", [row.id]);
      await job(t, batchId, "underwrite", row.id, applicantId, appId, "completed", userId, null, "Demo Lender");
      await job(t, batchId, "approve", row.id, applicantId, appId, "completed", userId, null, "Demo Lender");

      // Agreement (86% of approved)
      if (rng() < 0.14) {
        await run("UPDATE gn_bulk_rows SET status = 'approved', error = 'Agreement pending' WHERE id = ?", [row.id]);
        await bulkError(t, batchId, row.id, "document_missing", "Agreement pending customer signature", "Send agreement for eSign to complete the file");
        await job(t, batchId, "agreement", row.id, applicantId, appId, "failed", userId, "Agreement pending", "Demo eSign");
        errors++;
        continue;
      }
      await simulateLender(t, appId, "agreement", userId);
      await job(t, batchId, "agreement", row.id, applicantId, appId, "completed", userId, null, "Demo eSign");

      // Disburse (92% of agreements)
      if (rng() < 0.08) {
        await run("UPDATE gn_bulk_rows SET status = 'approved', error = 'Disbursement pending' WHERE id = ?", [row.id]);
        await bulkError(t, batchId, row.id, "disbursement", "Disbursement pending lender action", "Wait for lender disbursement or follow up via lender portal");
        await job(t, batchId, "disburse", row.id, applicantId, appId, "failed", userId, "Disbursement pending", "Demo Lender");
        errors++;
        continue;
      }
      const disbAmount = a.loan_amount ?? 0;
      await simulateLender(t, appId, "disburse", userId, { amount: disbAmount });
      await simulateLender(t, appId, "fund", userId, { amount: disbAmount });
      await simulateLender(t, appId, "confirm", userId);
      disbursed++;
      disbursedAmount += disbAmount;
      await run("UPDATE gn_bulk_rows SET status = 'disbursed' WHERE id = ?", [row.id]);
      await job(t, batchId, "disburse", row.id, applicantId, appId, "completed", userId, null, "Demo Lender");

      // Payout
      await simulateLender(t, appId, "payout", userId);
      await job(t, batchId, "payout", row.id, applicantId, appId, "completed", userId, null, "Demo Payout");
    } catch (e: any) {
      errors++;
      await run("UPDATE gn_bulk_rows SET status = 'failed', error = ? WHERE id = ?", [String(e?.message ?? e), row.id]);
      await bulkError(t, batchId, row.id, "lender_api", String(e?.message ?? e), "Automatically queued for retry");
      await job(t, batchId, "process", row.id, null, null, "failed", userId, String(e?.message ?? e), null);
    }
  }

  const expectedPayout = Math.round((disbursedAmount * (settings.gst_pct ? 1 : 1) * 0.01)); // illustrative 1% demo payout
  await run(
    `UPDATE gn_bulk_batches SET status = 'completed', progress = 100, applicants_created = ?, applications_created = ?,
       submitted = ?, approved = ?, disbursed = ?, disbursed_amount = ?, expected_payout = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [created, submitted, submitted, approved, disbursed, disbursedAmount, expectedPayout, batchId]
  );
  await run("UPDATE gn_bulk_batches SET applications_created = (SELECT COUNT(*) FROM gn_bulk_rows WHERE batch_id = ? AND application_id IS NOT NULL) WHERE id = ?", [batchId, batchId]);
  return { processed: rows.length, created, submitted, approved, disbursed, errors };
}
