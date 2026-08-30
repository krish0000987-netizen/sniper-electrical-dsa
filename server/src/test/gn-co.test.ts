/**
 * GN Command Center suite — applicant lifecycle: OTP → consent → KYC → credit → match →
 * application → submit → lender journey → payout, plus the RUN DEMO scenario and RBAC locks.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";
import type { Server } from "node:http";

const DB = path.join(tmpdir(), `nexus-gn-co-test-${process.pid}.db`);
process.env.NEXUS_DB = DB;
process.env.NEXUS_PORT = "0";

let server: Server;
let base = "";
let adminToken = "";
let dsaToken = "";

async function api(pathname: string, { method = "GET", token, body }: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(base + "/api" + pathname, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json: any = await res.json().catch(() => ({}));
  return { status: res.status, json, ok: res.ok };
}

async function login(email: string) {
  const { json } = await api("/auth/login", { method: "POST", body: { email, password: "demo1234" } });
  assert.ok(json.token, `login ${email}`);
  return json.token;
}

before(async () => {
  const { createApp } = await import("../app.js");
  const app = await createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 8787}`;
  adminToken = await login("admin@nexus.demo");
  dsaToken = await login("dsa@nexus.demo");
});

after(() => {
  server?.close();
  rmSync(DB, { force: true });
  rmSync(DB + "-wal", { force: true });
  rmSync(DB + "-shm", { force: true });
});

test("overview KPIs and funnel are database-driven", async () => {
  const { json } = await api("/gn/co/overview", { token: adminToken });
  assert.ok(json.kpi.total >= 12, `seeded applicants present (${json.kpi.total})`);
  assert.ok(json.kpi.disbursed >= 3, "demo applicants disbursed");
  assert.ok(json.payouts.disbursed_amount > 0, "disbursement amount recorded");
  assert.ok(json.funnel.applicants === json.kpi.total, "funnel applicant count matches");
  assert.ok(json.funnel.payout_received >= 3, "funnel payout stage reached");
});

test("full applicant lifecycle: OTP → consent → KYC → credit → match → application → submit → lender journey → payout", async () => {
  const created = await api("/gn/co/applicants", {
    method: "POST", token: adminToken,
    body: { name: "Test Applicant One", mobile: "9898989898", loan_type: "Business Loan", loan_amount: 1500000, tenure: 36, source: "test" }
  });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const id = created.json.id;

  // OTP
  const otp = await api(`/gn/co/applicants/${id}/otp`, { method: "POST", token: adminToken, body: { action: "send" } });
  assert.equal(otp.json.otp, "123456", "demo OTP exposed in demo mode");
  const bad = await api(`/gn/co/applicants/${id}/otp`, { method: "POST", token: adminToken, body: { action: "verify", otp: "000000" } });
  assert.equal(bad.status, 400);
  const ok = await api(`/gn/co/applicants/${id}/otp`, { method: "POST", token: adminToken, body: { action: "verify", otp: "123456" } });
  assert.equal(ok.json.ok, true);

  // KYC blocked without consent
  const kycBlocked = await api(`/gn/co/applicants/${id}/kyc`, { method: "POST", token: adminToken, body: {} });
  assert.equal(kycBlocked.status, 400, "KYC requires consent");
  await api(`/gn/co/applicants/${id}/consent`, { method: "POST", token: adminToken, body: {} });

  // KYC + credit
  const kyc = await api(`/gn/co/applicants/${id}/kyc`, { method: "POST", token: adminToken, body: {} });
  assert.equal(kyc.json.kyc_status, "completed");
  const credit = await api(`/gn/co/applicants/${id}/credit`, { method: "POST", token: adminToken, body: {} });
  assert.equal(credit.status, 200);
  assert.ok(credit.json.profile.score >= 600 && credit.json.profile.score <= 799, "demo credit score band");

  // Match
  const match = await api(`/gn/co/applicants/${id}/match`, { method: "POST", token: adminToken, body: {} });
  assert.ok(match.json.matches.length >= 1, "at least one lender match");
  const best = match.json.matches.find((m: any) => m.status === "eligible") ?? match.json.matches[0];
  assert.ok(best.score >= 0 && best.score <= 100, "match score 0-100");

  // Application
  const apply = await api(`/gn/co/applicants/${id}/apply`, { method: "POST", token: adminToken, body: { match_id: best.id } });
  assert.equal(apply.status, 200);
  const appRef = apply.json.application.ref;
  assert.match(appRef, /^GN-\d{4}-\d{5}$/, "application ref format");

  // Docs
  const docComplete = await api(`/gn/co/applicants/${id}/docs-complete`, { method: "POST", token: adminToken, body: {} });
  assert.equal(docComplete.json.doc_status, "completed");

  // Submit
  const submit = await api(`/gn/co/applicants/${id}/submit`, { method: "POST", token: adminToken, body: {} });
  assert.equal(submit.json.application.status, "submitted");

  // Lender journey
  const uw = await api(`/gn/co/applicants/${id}/lender`, { method: "POST", token: adminToken, body: { action: "underwrite" } });
  assert.equal(uw.json.application.status, "uw");
  const approve = await api(`/gn/co/applicants/${id}/lender`, { method: "POST", token: adminToken, body: { action: "approve", amount: 1500000 } });
  assert.equal(approve.json.application.status, "approved");
  const sanction = await api(`/gn/co/applicants/${id}/lender`, { method: "POST", token: adminToken, body: { action: "sanction" } });
  assert.equal(sanction.json.application.status, "sanction_generated");
  const agreement = await api(`/gn/co/applicants/${id}/lender`, { method: "POST", token: adminToken, body: { action: "agreement" } });
  assert.equal(agreement.json.application.status, "agreement_completed");
  const disb = await api(`/gn/co/applicants/${id}/lender`, { method: "POST", token: adminToken, body: { action: "disburse", amount: 1500000 } });
  assert.equal(disb.json.application.status, "disb_initiated");
  const fund = await api(`/gn/co/applicants/${id}/lender`, { method: "POST", token: adminToken, body: { action: "fund", amount: 1500000 } });
  assert.equal(fund.json.application.status, "disb_fully");
  const confirm = await api(`/gn/co/applicants/${id}/lender`, { method: "POST", token: adminToken, body: { action: "confirm" } });
  assert.equal(confirm.json.application.status, "disb_confirmed");
  assert.ok(confirm.json.application.commission_gross > 0, "commission auto-calculated on disbursement");
  const payout = await api(`/gn/co/applicants/${id}/lender`, { method: "POST", token: adminToken, body: { action: "payout" } });
  assert.equal(payout.json.application.status, "payout_received");

  // Detail shows all sub-records
  const detail = await api(`/gn/co/applicants/${id}`, { token: adminToken });
  assert.ok(detail.json.kyc.length === 5, "5 KYC verifications");
  assert.ok(detail.json.credit, "credit profile");
  assert.ok(detail.json.matches.length >= 1, "matches stored");
  assert.ok(detail.json.sanctions.length === 1, "sanction record");
  assert.ok(detail.json.agreements.length === 1, "agreement record");
  assert.ok(detail.json.disbursements.length === 1, "disbursement record");
  assert.ok(detail.json.payouts.length === 1, "payout record");
  assert.ok(detail.json.events.length >= 8, "event timeline populated");
});

test("RUN DEMO scenario walks Rahul Sharma through the full journey", async () => {
  const { json } = await api("/gn/co/demo", { method: "POST", token: adminToken });
  assert.ok(json.applicantId, "demo applicant created");
  assert.match(json.ref, /^GN-\d{4}-\d{5}$/);
  const detail = await api(`/gn/co/applicants/${json.applicantId}`, { token: adminToken });
  const app = detail.json.applications[0];
  assert.equal(detail.json.applicant.name, "Rahul Sharma");
  assert.equal(app.status, "payout_received");
  assert.equal(app.disbursed_amount, 2500000, "₹25L disbursed per the reference story");
  assert.ok(detail.json.payouts[0].gross > 0, "payout calculated");
});

test("queue tabs filter applicants correctly", async () => {
  const disb = await api("/gn/co/applicants?tab=disbursement&limit=200", { token: adminToken });
  assert.ok(disb.json.rows.every((r: any) => ["disb_initiated"].includes(r.app_status)));
  const payout = await api("/gn/co/applicants?tab=payout&limit=200", { token: adminToken });
  assert.ok(payout.json.rows.every((r: any) => ["disbursed", "payout"].includes(r.app_status)));
});

test("RBAC: locked command-center modules are denied to DSA", async () => {
  const list = await api("/gn/co/applicants", { token: dsaToken });
  assert.equal(list.status, 403, "dsa cannot list command-center applicants");
  const overview = await api("/gn/co/overview", { token: dsaToken });
  assert.equal(overview.status, 403);
  const analytics = await api("/gn/co/analytics", { token: dsaToken });
  assert.equal(analytics.status, 403);
});

test("analytics endpoints aggregate live records", async () => {
  const { json } = await api("/gn/co/analytics", { token: adminToken });
  assert.ok(json.funnel.applicants >= 12);
  assert.ok(json.funnel.disbursements >= 3);
  assert.ok(json.revenue.gross > 0);
  assert.ok(json.byLender.length >= 1);
});
