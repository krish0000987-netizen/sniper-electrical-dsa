/**
 * NEXUS expansion engines — eligibility pre-screening, document checklists,
 * SLA/escalation, credit memo, duplicate detection and offer generation.
 * All functions are deterministic and operate on tenant-scoped rows.
 */
import { q, q1, run, now } from "../db/connection.js";
import { buildApplicationContext, capacityMetrics } from "./ctx.js";
import { computeEmi, computeApr } from "./finance.js";

export const inrShort = (n: number): string => "₹" + n.toLocaleString("en-IN");

/* ------------------------------------------------------------------ */
/* Append-only loan event ledger                                       */
/* ------------------------------------------------------------------ */

export async function recordLoanEvent(
  loanId: number,
  kind: string,
  opts: { tenantId?: number; amount?: number; reference?: string; data?: Record<string, unknown>; userId?: number } = {}
) {
  const loan = await q1<Record<string, any>>("SELECT * FROM loans WHERE id = ?", [loanId]);
  const tenantId = opts.tenantId ?? loan?.tenant_id ?? 0;
  return (await run(
    "INSERT INTO loan_events (tenant_id, loan_id, kind, amount, reference, data, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [tenantId, loanId, kind, opts.amount ?? null, opts.reference ?? null, JSON.stringify(opts.data ?? {}), opts.userId ?? null]
  )).lastId;
}

/* ------------------------------------------------------------------ */
/* Eligibility / pre-screening engine                                  */
/* ------------------------------------------------------------------ */

export interface EligibilityCheck {
  key: string;
  label: string;
  value: string;
  threshold: string;
  passed: boolean;
  hard: boolean;
}

export async function eligibilityEngine(applicationId: number) {
  const ctx = await buildApplicationContext(applicationId);
  const app = await q1<Record<string, any>>("SELECT * FROM applications WHERE id = ?", [applicationId]);
  if (!app) return { verdict: "NOT_ELIGIBLE", checks: [], reasons: ["Application not found"], grade: "high" };
  const cap = capacityMetrics(ctx);
  const product = await q1<Record<string, any>>("SELECT * FROM products WHERE id = ?", [app.product_id]);
  const amount = Number(app.requested_amount ?? 0);
  const tenure = Number(app.tenure ?? 0);
  const age = Number(ctx["customer.age"] ?? 0);
  const score = Number(ctx["credit.score"] ?? 0);
  const income = Number(ctx["bank.monthly_income"] ?? ctx["customer.monthly_income"] ?? 0);
  const foir = cap.foir;
  const exposure = Number(ctx["exposure.total"] ?? 0);
  const secured = ["lap", "home", "vehicle", "gold", "commercial_vehicle"].includes(product?.category ?? "");
  const collateral = await q1<Record<string, any>>("SELECT * FROM collaterals WHERE application_id = ? ORDER BY id DESC LIMIT 1", [applicationId]);
  const category = product?.category ?? "";

  const checks: EligibilityCheck[] = [];
  const soft: string[] = [];
  const hard: string[] = [];

  const add = (key: string, label: string, value: number | string, threshold: string, passed: boolean, isHard: boolean) => {
    checks.push({ key, label, value: String(value), threshold, passed, hard: isHard });
    if (!passed) (isHard ? hard : soft).push(`${label} — got ${String(value)}, expected ${threshold}`);
  };

  add("amount", "Requested amount within product band", inrShort(amount),
    `${inrShort(product?.min_amount)} – ${inrShort(product?.max_amount)}`,
    amount >= (product?.min_amount ?? 0) && amount <= (product?.max_amount ?? Infinity), true);
  add("tenure", "Tenure within product band", `${tenure} months`,
    `${product?.min_tenure} – ${product?.max_tenure} months`,
    tenure >= (product?.min_tenure ?? 0) && tenure <= (product?.max_tenure ?? Infinity), true);
  add("age", "Borrower age", `${age} yrs`, "21 – 65 yrs", age >= 21 && age <= 65, true);
  add("income", "Monthly income", inrShort(income), "≥ ₹20,000", income >= 20000, true);
  if (score > 0) {
    add("bureau", "Bureau score", String(score), "≥ 650", score >= 650, false);
  } else {
    add("bureau", "Bureau score", "not fetched", "≥ 650", true, false);
  }
  if (foir !== null) add("foir", "FOIR (existing obligations / income)", `${foir}%`, "≤ 55%", foir <= 55, false);
  add("exposure", "Existing exposure", inrShort(exposure), "≤ ₹25,00,000", exposure <= 2500000, false);

  if (secured) {
    if (collateral) {
      const ltv = collateral.value > 0 ? Math.round((amount / collateral.value) * 1000) / 10 : 100;
      const ltvCaps: Record<string, number> = { lap: 65, home: 80, vehicle: 85, gold: 75, commercial_vehicle: 85 };
      const capLtv = ltvCaps[category] ?? 85;
      add("ltv", `LTV (${category.toUpperCase()})`, `${ltv}%`, `≤ ${capLtv}%`, ltv <= capLtv, true);
    } else {
      add("ltv", "Security / collateral", "none registered", "required for secured product", false, true);
    }
  }

  let verdict = "ELIGIBLE";
  let reasons = hard.length ? hard : soft;
  let grade = "low";
  if (hard.length) {
    verdict = "NOT_ELIGIBLE";
    grade = "high";
  } else if (soft.length) {
    verdict = "MAYBE";
    grade = "medium";
    reasons = [...soft, "Soft checks failed — manual underwriting review recommended"];
  } else {
    reasons = ["All eligibility checks passed"];
  }
  return { verdict, checks, reasons, grade, metrics: { ...cap, age, score, amount, tenure, ltv: checks.find((c) => c.key === "ltv")?.value } };
}

/* ------------------------------------------------------------------ */
/* Document checklist engine                                           */
/* ------------------------------------------------------------------ */

export async function documentChecklist(applicationId: number) {
  const app = await q1<Record<string, any>>("SELECT * FROM applications WHERE id = ?", [applicationId]);
  if (!app) return { rows: [] };
  const cust = await q1<Record<string, any>>("SELECT * FROM customers WHERE id = ?", [app.customer_id]);
  const product = await q1<Record<string, any>>("SELECT * FROM products WHERE id = ?", [app.product_id]);
  const category = product?.category ?? "";
  const emp = cust?.employment_type ?? "salaried";
  const docs = await q<Record<string, any>>("SELECT * FROM documents WHERE application_id = ?", [applicationId]);

  const rules: { category: string; name: string; required: boolean }[] = [
    { category: "pan", name: "PAN Card", required: true },
    { category: "aadhaar", name: "Aadhaar / OVD", required: true },
    { category: "address_proof", name: "Address Proof", required: true },
    { category: "bank_statement", name: "Bank Statement (6 months)", required: true },
    { category: "salary_slip", name: "Salary Slips", required: emp === "salaried" },
    { category: "itr", name: "Income Tax Returns", required: emp !== "salaried" },
    { category: "business_reg", name: "Business Registration", required: emp === "business" },
    { category: "gst", name: "GST Registration & Returns", required: emp === "business" || category === "msme" },
    { category: "property", name: "Property Documents", required: category === "lap" || category === "home" },
    { category: "vehicle", name: "Vehicle Documents", required: category === "vehicle" }
  ];

  const rows = rules.map((r) => {
    const matches = docs.filter((d) => d.category === r.category);
    const latest = matches[matches.length - 1];
    let status = r.required ? "missing" : "not_required";
    if (latest) {
      status = latest.status === "verified" ? "verified" : latest.status === "rejected" ? "rejected" : "uploaded";
    }
    return { ...r, status, documents: matches.map((d) => ({ id: d.id, name: d.name, status: d.status, version: d.version, verified_at: d.verified_at, ocr_confidence: d.ocr_confidence })) };
  });
  const verified = rows.filter((r) => r.status === "verified").length;
  const required = rows.filter((r) => r.required).length;
  return { rows, summary: { verified, required, missing: required - verified } };
}

/* ------------------------------------------------------------------ */
/* SLA & escalation engine                                             */
/* ------------------------------------------------------------------ */

export async function slaStatus(application: Record<string, any>) {
  const stage = application.stage;
  const wf = await q1<Record<string, any>>("SELECT * FROM workflow_stages WHERE product_id IS NULL AND code = ? AND active = 1", [stage])
    ?? await q1<Record<string, any>>("SELECT * FROM workflow_stages WHERE code = ? AND active = 1 ORDER BY id DESC LIMIT 1", [stage]);
  const stageRow = await q1<Record<string, any>>(
    "SELECT * FROM application_stages WHERE application_id = ? AND stage = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1",
    [application.id, stage]
  );
  if (!wf || !stageRow || !stageRow.entered_at) {
    return { status: "on_track", sla_hours: wf?.sla_hours ?? 24, elapsed_hours: 0, breach_at: null, escalated: 0, stage_name: wf?.name ?? stage };
  }
  const entered = new Date(stageRow.entered_at + (stageRow.entered_at.length === 10 ? "T00:00:00Z" : "")).getTime();
  const elapsed = Math.max(0, (Date.now() - entered) / 3600000);
  const sla = wf.sla_hours || 24;
  const pct = elapsed / sla;
  const status = pct >= 1 ? "breached" : pct >= 0.7 ? "at_risk" : "on_track";
  return {
    status,
    sla_hours: sla,
    elapsed_hours: Math.round(elapsed * 10) / 10,
    pct: Math.round(pct * 100),
    breach_at: new Date(entered + sla * 3600000).toISOString(),
    escalated: pct >= 1 ? 1 : 0,
    stage_name: wf.name,
    approver_role: wf.approver_role ?? null
  };
}

export async function slaSummary(tenantId: number) {
  const apps = await q<Record<string, any>>(
    `SELECT a.id, a.application_no, a.stage, a.status, c.name AS customer_name,
            (SELECT entered_at FROM application_stages s WHERE s.application_id = a.id AND s.status = 'in_progress' ORDER BY s.id DESC LIMIT 1) AS entered_at
     FROM applications a JOIN customers c ON c.id = a.customer_id
     WHERE a.tenant_id = ? AND a.status = 'in_progress'`, [tenantId]);
  let atRisk = 0, breached = 0;
  const breaches: Record<string, any>[] = [];
  for (const a of apps) {
    const s = await slaStatus(a);
    if (s.status === "at_risk") atRisk++;
    if (s.status === "breached") { breached++; breaches.push({ id: a.id, application_no: a.application_no, customer_name: a.customer_name, stage: a.stage, stage_name: s.stage_name, elapsed_hours: s.elapsed_hours, sla_hours: s.sla_hours }); }
  }
  return { at_risk: atRisk, breached, breaches: breaches.slice(0, 12) };
}

/* ------------------------------------------------------------------ */
/* Duplicate detection                                                 */
/* ------------------------------------------------------------------ */

export async function duplicateScan(tenantId: number, input: { pan?: string; mobile?: string; email?: string; name?: string }) {
  const where: string[] = ["tenant_id = ?"];
  const params: unknown[] = [tenantId];
  if (input.pan) { where.push("pan = ?"); params.push(String(input.pan).toUpperCase().trim()); }
  if (input.mobile) { where.push("mobile = ?"); params.push(input.mobile.trim()); }
  if (input.email) { where.push("LOWER(email) = ?"); params.push(String(input.email).trim().toLowerCase()); }
  if (!input.pan && !input.mobile && !input.email) return { matches: [] };
  const customers = await q<Record<string, any>>(`SELECT * FROM customers WHERE ${where.join(" OR ")}`, params);
  const matches = await Promise.all(customers.map(async (c) => {
    const apps = await q<Record<string, any>>(
      `SELECT a.id, a.application_no, a.status, a.stage, p.name AS product_name FROM applications a JOIN products p ON p.id = a.product_id WHERE a.customer_id = ? ORDER BY a.id DESC LIMIT 5`,
      [c.id]);
    const loans = await q<Record<string, any>>("SELECT id, loan_no, status, outstanding FROM loans WHERE customer_id = ? AND status NOT IN ('closed','written_off') LIMIT 5", [c.id]);
    const flags: string[] = [];
    if (input.pan && c.pan === input.pan.toUpperCase().trim()) flags.push("same PAN");
    if (input.mobile && c.mobile === input.mobile.trim()) flags.push("same mobile");
    if (input.email && c.email?.toLowerCase() === input.email.trim().toLowerCase()) flags.push("same email");
    return { customer: { id: c.id, customer_no: c.customer_no, name: c.name, mobile: c.mobile, city: c.city, kyc_status: c.kyc_status }, flags, applications: apps, active_loans: loans };
  }));
  return { matches };
}

/* ------------------------------------------------------------------ */
/* Credit memo / appraisal generator                                   */
/* ------------------------------------------------------------------ */

export async function creditMemoContent(applicationId: number) {
  const app = await q1<Record<string, any>>(
    `SELECT a.*, c.name AS customer_name, c.mobile, c.email, c.dob, c.employment_type, c.business_name,
            c.annual_income, c.monthly_income, c.business_turnover, c.credit_score, c.risk_class, c.city, c.state, c.kyc_status,
            p.name AS product_name, p.category, p.interest_rate, p.processing_fee_pct
     FROM applications a JOIN customers c ON c.id = a.customer_id JOIN products p ON p.id = a.product_id WHERE a.id = ?`,
    [applicationId]);
  if (!app) return {};
  const el = await eligibilityEngine(applicationId);
  const ctx = await buildApplicationContext(applicationId);
  const cap = capacityMetrics(ctx);
  const bureau = await q1<Record<string, any>>("SELECT * FROM bureau_reports WHERE customer_id = ? ORDER BY id DESC LIMIT 1", [app.customer_id]);
  const bank = await q1<Record<string, any>>("SELECT * FROM bank_analyses WHERE application_id = ? ORDER BY id DESC LIMIT 1", [applicationId]);
  const gst = await q1<Record<string, any>>("SELECT * FROM gst_profiles WHERE customer_id = ? ORDER BY id DESC LIMIT 1", [app.customer_id]);
  const collateral = await q<Record<string, any>>("SELECT * FROM collaterals WHERE application_id = ?", [applicationId]);
  const parties = await q<Record<string, any>>("SELECT * FROM parties WHERE application_id = ?", [applicationId]);
  const exceptions = await q<Record<string, any>>("SELECT * FROM policy_exceptions WHERE application_id = ? ORDER BY id DESC", [applicationId]);
  const bre = await q<Record<string, any>>(
    `SELECT b.code, b.name, e.passed FROM bre_evaluations e JOIN bre_rules b ON b.id = e.rule_id WHERE e.application_id = ? ORDER BY b.priority`, [applicationId]);

  const emi = computeEmi(app.approved_amount || app.requested_amount, app.rate || app.interest_rate, app.tenure);
  const fee = Math.round(((app.approved_amount || app.requested_amount) * app.processing_fee_pct) / 100);
  const apr = computeApr(app.approved_amount || app.requested_amount, app.rate || app.interest_rate, app.tenure, fee, emi);

  return {
    application_no: app.application_no,
    generated_at: now(),
    customer: {
      name: app.customer_name, mobile: app.mobile, dob: app.dob, age: ctx["customer.age"],
      employment_type: app.employment_type, business_name: app.business_name,
      monthly_income: app.monthly_income, annual_income: app.annual_income, turnover: app.business_turnover,
      city: app.city, kyc_status: app.kyc_status, risk_class: app.risk_class
    },
    loan_request: { product: app.product_name, category: app.category, amount: app.requested_amount, tenure: app.tenure, purpose: app.purpose },
    eligibility: { verdict: el.verdict, reasons: el.reasons },
    capacity: { income: cap.income, obligations: cap.obligations, surplus: cap.surplus, foir: cap.foir, dscr: cap.dscr },
    credit: bureau ? { score: bureau.score, band: bureau.score_band, active_accounts: bureau.active_accounts, overdue_accounts: bureau.overdue_accounts, outstanding: bureau.total_outstanding, utilization: bureau.credit_utilization, enquiries_6m: bureau.enquiries_6m, dpd_max: bureau.dpd_max } : null,
    banking: bank ? { monthly_income: bank.monthly_income, monthly_expense: bank.monthly_expense, avg_balance: bank.avg_balance, emi_obligations: bank.emi_obligations, surplus: bank.banking_surplus, bounces: bank.bounce_count, risk: bank.risk } : null,
    gst: gst ? { turnover: gst.turnover, filing_status: gst.filing_status, declared_vs_banking: gst.declared_vs_banking_pct } : null,
    collateral: collateral.map((c) => ({ asset_type: c.asset_type, value: c.value, valuation: c.valuation, ltv: c.ltv, verification_status: c.verification_status })),
    parties: parties.map((p) => ({ type: p.type, name: p.name, relationship: p.relationship, monthly_income: p.monthly_income })),
    policy_exceptions: exceptions.map((e) => ({ rule_name: e.rule_name, reason: e.reason, status: e.status })),
    bre: { result: app.bre_result, detail: bre.map((r) => ({ rule: r.name, passed: !!r.passed })) },
    proposal: { amount: app.approved_amount || app.requested_amount, tenure: app.tenure, rate: app.rate || app.interest_rate, emi, fee, apr },
    recommendation: app.decision === "approve" ? "APPROVE" : app.decision === "reject" ? "REJECT" : "RECOMMEND APPROVE WITH CONDITIONS",
    risk: app.risk_grade ?? "standard"
  };
}

/* ------------------------------------------------------------------ */
/* Offer comparison engine                                             */
/* ------------------------------------------------------------------ */

export async function generateOffers(applicationId: number) {
  const app = await q1<Record<string, any>>("SELECT * FROM applications WHERE id = ?", [applicationId]);
  if (!app) return { offers: [] };
  const product = await q1<Record<string, any>>("SELECT * FROM products WHERE id = ?", [app.product_id]);
  const base = Number(app.requested_amount ?? product?.min_amount ?? 100000);
  const baseTenure = Number(app.tenure ?? Math.min(product?.max_tenure ?? 36, 36));
  const rate = Number(app.rate ?? product?.interest_rate ?? 16);
  const feePct = Number(product?.processing_fee_pct ?? 2);
  const variants = [
    { label: "Offer A", factor: 1.0, tenureFactor: 1.0, rateDelta: 0 },
    { label: "Offer B", factor: 1.25, tenureFactor: 1.35, rateDelta: 0.75 },
    { label: "Offer C", factor: 0.8, tenureFactor: 0.75, rateDelta: -0.75 }
  ];
  const offers = variants.map((v) => {
    const amount = Math.min(product?.max_amount ?? base * 2, Math.round((base * v.factor) / 5000) * 5000);
    const tenure = Math.min(product?.max_tenure ?? 120, Math.max(product?.min_tenure ?? 6, Math.round((baseTenure * v.tenureFactor) / 3) * 3));
    const r = Math.round((rate + v.rateDelta) * 100) / 100;
    const emi = computeEmi(amount, r, tenure);
    const fees = Math.round((amount * feePct) / 100) + Math.round((amount * feePct * 0.18) / 100);
    const apr = computeApr(amount, r, tenure, fees, emi);
    return {
      label: v.label, amount, tenure, rate: r, emi, apr, fees,
      total_repayment: emi * tenure + fees,
      risk_grade: v.rateDelta > 0 ? "standard" : v.rateDelta < 0 ? "low" : "standard",
      conditions: ["Standard terms", v.factor >= 1 ? "Guarantor may be required above ₹10L" : "First EMI 1 month after disbursement"]
    };
  });
  return { offers, currency: "INR" };
}
