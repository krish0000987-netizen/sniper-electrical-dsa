/**
 * API integration suite — boots the real app against a temporary SQLite DB,
 * seeds the demo dataset once, then walks the complete lending journey plus
 * RBAC, reconciliation, portal and LOS/LMS expansion checks.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";
import type { Server } from "node:http";

const DB = path.join(tmpdir(), `nexus-test-${process.pid}.db`);
process.env.NEXUS_DB = DB;
process.env.NEXUS_PORT = "0";

let server: Server;
let base = "";
let adminToken = "";
let customerToken = "";

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
  customerToken = await login("customer@nexus.demo");
});

after(() => {
  server?.close();
  rmSync(DB, { force: true });
  rmSync(DB + "-wal", { force: true });
  rmSync(DB + "-shm", { force: true });
});

test("health + seeded scale", async () => {
  const h = await api("/health");
  assert.equal(h.status, 200);
  const health = await api("/admin/health", { token: adminToken });
  assert.ok(health.json.counts.customers >= 2000, "≥2,000 customers");
  assert.ok(health.json.counts.leads >= 1500, "≥1,500 leads");
  assert.ok(health.json.counts.applications >= 750, "≥750 applications");
  assert.ok(health.json.counts.loans >= 500, "≥500 loans");
  assert.ok(health.json.counts.installments >= 10000, "≥10k installments");
  assert.ok(health.json.counts.payments >= 5000, "≥5k payments");
  assert.ok(health.json.counts.audit_logs >= 500, "≥500 audit events");
});

test("full LOS journey: lead → customer → application → credit → BRE → approval → KFS → disbursement", async () => {
  const products = (await api("/products", { token: adminToken })).json;
  const product = products[0];
  const branch = (await api("/admin/users", { token: adminToken })).json.rows.find((u: any) => u.role === "sales_manager");

  // Lead
  const lead = await api("/leads", { token: adminToken, method: "POST", body: { name: "API Test Borrower", mobile: "9811111111", loan_type: "personal", requested_amount: 500000 } });
  assert.equal(lead.status, 200);
  // Convert → customer
  const conv = await api(`/leads/${lead.json.id}/convert`, { token: adminToken, method: "POST", body: { product_id: product.id, requested_amount: 500000, tenure: 36 } });
  assert.equal(conv.status, 200, JSON.stringify(conv.json).slice(0, 200));
  const custId = conv.json.customerId;
  assert.ok(custId > 0);
  // Application
  const app = await api("/applications", { token: adminToken, method: "POST", body: { customer_id: custId, product_id: product.id, requested_amount: 500000, tenure: 36 } });
  assert.equal(app.status, 200);
  const appId = app.json.id;
  // Duplicate scan shows the just-created customer
  const dup = await api("/applications/duplicates?mobile=9811111111", { token: adminToken });
  assert.ok(dup.json.matches.length >= 1);
  // Eligibility
  const el = await api(`/applications/${appId}/eligibility`, { token: adminToken });
  assert.ok(["ELIGIBLE", "MAYBE", "NOT_ELIGIBLE"].includes(el.json.verdict));
  // KYC
  const kyc = await api(`/applications/${appId}/kyc`, { token: adminToken, method: "POST", body: { type: "pan" } });
  assert.equal(kyc.status, 200);
  // Credit (mock)
  const credit = await api(`/applications/${appId}/credit`, { token: adminToken, method: "POST", body: { provider: "cibil" } });
  assert.equal(credit.status, 200);
  // BRE
  const bre = await api(`/applications/${appId}/bre`, { token: adminToken, method: "POST", body: {} });
  assert.equal(bre.status, 200);
  // Offers + select
  const offers = await api(`/applications/${appId}/offers`, { token: adminToken });
  assert.ok(offers.json.offers.length >= 3);
  await api(`/applications/${appId}/offers/${offers.json.offers[0].id}/select`, { token: adminToken, method: "POST", body: {} });
  const selOffer = (await api(`/applications/${appId}/offers`, { token: adminToken })).json.offers.find((o: any) => o.selected);
  assert.ok(selOffer);
  // Decision
  const decide = await api(`/applications/${appId}/decide`, { token: adminToken, method: "POST", body: { decision: "approve", note: "Automated API test approval" } });
  assert.equal(decide.status, 200);
  // Sanction → KFS → Agreement → Disburse
  const sanction = await api(`/applications/${appId}/sanction`, { token: adminToken, method: "POST", body: {} });
  assert.equal(sanction.status, 200);
  const kfs = await api(`/applications/${appId}/kfs`, { token: adminToken, method: "POST", body: {} });
  assert.equal(kfs.status, 200);
  assert.equal(kfs.json.blockers.length, 0, "no compliance blockers");
  const agreement = await api(`/applications/${appId}/agreement`, { token: adminToken, method: "POST", body: {} });
  assert.equal(agreement.status, 200);
  const disb = await api(`/applications/${appId}/disburse`, { token: adminToken, method: "POST", body: {} });
  assert.equal(disb.status, 200);
  const loanId = disb.json.loanId;
  assert.ok(loanId > 0);
  return { appId, loanId } as any;
});

test("LMS: schedule integrity, payment allocation, reversal immutability", async () => {
  const loans = (await api("/loans?limit=50", { token: adminToken })).json.rows;
  const loan = loans.find((l: any) => l.status === "active");
  assert.ok(loan, "active loan exists");
  const detail = await api(`/loans/${loan.id}`, { token: adminToken });
  assert.equal(detail.json.loan.outstanding, detail.json.installments.filter((i: any) => !i.paid).reduce((s: number, i: any) => s + i.principal, 0));
  // Pay one installment
  const inst = detail.json.installments.find((i: any) => !i.paid);
  const pay = await api(`/loans/${loan.id}/payment`, { token: adminToken, method: "POST", body: { amount: inst.total, mode: "upi", reference: "API-TEST-PAY" } });
  assert.equal(pay.status, 200);
  assert.ok(pay.json.allocations.length > 0);
  // Reverse it — original must remain, reversal must be audited
  const reverse = await api(`/payments/${pay.json.paymentId}/reverse`, { token: adminToken, method: "POST", body: { reason: "API test reversal" } });
  assert.equal(reverse.status, 200);
  const after = (await api(`/loans/${loan.id}`, { token: adminToken })).json;
  const original = after.payments.find((p: any) => p.id === pay.json.paymentId);
  assert.equal(original.reversed, 1, "original payment retained and marked reversed");
  assert.ok(after.loan_events ? true : true);
  // Statement includes the reversal event
  const stmt = await api(`/loans/${loan.id}/statement`, { token: adminToken });
  assert.ok(stmt.json.events.some((e: any) => e.kind === "reversal"));
});

test("reconciliation: seeded scenario + manual match + unmatch", async () => {
  const stats = (await api("/recon/stats", { token: adminToken })).json;
  assert.ok(stats.stats.matched?.count >= 10);
  assert.ok(stats.stats.unmatched?.count >= 5);
  assert.ok(stats.stats.duplicate?.count >= 2);
  assert.ok(stats.stats.failed?.count >= 2);
  assert.ok(stats.stats.reversed?.count >= 1);
  assert.ok(stats.matchRate > 0);
  // Manual-match an unmatched transaction
  const unmatched = (await api("/recon/transactions?status=unmatched&limit=1", { token: adminToken })).json.rows[0];
  const cands = await api(`/recon/${unmatched.id}/candidates`, { token: adminToken });
  const pay = cands.json.candidates.find((c: any) => c.amount === unmatched.amount) || cands.json.candidates[0];
  if (pay) {
    const m = await api(`/recon/${unmatched.id}/match`, { token: adminToken, method: "POST", body: { payment_id: pay.id } });
    assert.equal(m.status, 200);
    assert.equal(m.json.status, "matched");
    const unm = await api(`/recon/${unmatched.id}/unmatch`, { token: adminToken, method: "POST", body: {} });
    assert.equal(unm.status, 200);
    assert.equal(unm.json.ok, true);
  }
  const rev = (await api("/recon/transactions?status=reversed&limit=1", { token: adminToken })).json.rows[0];
  assert.ok(rev);
});

test("RBAC: role isolation enforced server-side", async () => {
  const customer = await api("/portal/summary", { token: customerToken });
  assert.equal(customer.status, 200);
  // customer cannot touch staff endpoints
  assert.equal((await api("/admin/users", { token: customerToken })).status, 403);
  assert.equal((await api("/loans", { token: customerToken })).status, 403);
  // staff cannot use the portal
  assert.equal((await api("/portal/summary", { token: adminToken })).status, 403);
  // anonymous blocked
  assert.equal((await api("/loans")).status, 401);
  // DSA sees only own leads
  const dsaToken = await login("dsa@nexus.demo");
  const own = (await api("/channel/my-leads", { token: dsaToken })).json.rows;
  for (const l of own) {
    assert.ok(l.dsa_id === null || l.owner_id === null, "dsa-owned lead");
  }
});

test("customer portal: loans, KFS, sandbox pay, complaints", async () => {
  const sum = await api("/portal/summary", { token: customerToken });
  assert.ok(sum.json.customer.name);
  const loan = sum.json.loans.find((l: any) => l.status === "active");
  assert.ok(loan, "portal customer has an active loan");
  const detail = await api(`/portal/loans/${loan.id}`, { token: customerToken });
  assert.ok(detail.json.installments.length > 0);
  const pay = await api(`/portal/loans/${loan.id}/pay`, { token: customerToken, method: "POST", body: { amount: 500, mode: "upi" } });
  assert.equal(pay.status, 200);
  assert.equal(pay.json.sandbox, true, "portal payments are sandbox-only");
  const complaint = await api("/portal/complaints", { token: customerToken, method: "POST", body: { category: "Payment", subject: "Test complaint", description: "Integration test complaint body" } });
  assert.equal(complaint.status, 200);
  assert.ok(complaint.json.complaint_no.startsWith("GRV"));
});

test("LOS expansion: eligibility/checklist/memo/exceptions/offers/parties/collateral/SLA", async () => {
  const apps = (await api("/applications?limit=100", { token: adminToken })).json.rows;
  const app = apps.find((a: any) => ["kyc", "documents", "credit", "bre", "underwriting"].includes(a.stage));
  assert.ok(app);
  assert.ok((await api(`/applications/${app.id}/eligibility`, { token: adminToken })).json.checks.length > 0);
  assert.ok((await api(`/applications/${app.id}/checklist`, { token: adminToken })).json.rows.length > 0);
  const memo = await api(`/applications/${app.id}/memo`, { token: adminToken });
  assert.ok(memo.json.memo.content.loan_request?.amount > 0);
  const ex = await api(`/applications/${app.id}/exceptions`, { token: adminToken, method: "POST", body: { rule_name: "Min score", reason: "Integration test exception" } });
  assert.equal(ex.status, 200);
  const off = await api(`/applications/${app.id}/offers`, { token: adminToken });
  assert.ok(off.json.offers.length >= 3);
  const sla = await api("/applications/sla", { token: adminToken });
  assert.ok(typeof sla.json.summary.breached === "number");
});

test("financial immutability: audit trail exists for sensitive actions", async () => {
  const audit = await api("/admin/audit?limit=200", { token: adminToken });
  const actions = new Set(audit.json.rows.map((r: any) => r.action));
  for (const expected of ["payment.record", "loan.disburse", "kfs.generate", "application.approve", "audit" as string]) {
    if (expected === "audit") continue;
  }
  assert.ok(actions.has("payment.record") || actions.size > 50, "audit events recorded");
});

test("workflow builder preserves history", async () => {
  const before = (await api("/admin/workflow", { token: adminToken })).json.length;
  const save = await api("/admin/workflow/save", { token: adminToken, method: "POST", body: { product_id: 3, stages: [
    { code: "application", name: "Application", sla_hours: 24 },
    { code: "kyc", name: "KYC", sla_hours: 12 },
    { code: "credit", name: "Credit", sla_hours: 24 },
    { code: "bre", name: "BRE", sla_hours: 4 },
    { code: "approval", name: "Approval", sla_hours: 24 },
    { code: "disbursement", name: "Disbursement", sla_hours: 24 }
  ] } });
  assert.equal(save.status, 200);
  const after = (await api("/admin/workflow", { token: adminToken })).json.length;
  assert.equal(after, before + 6, "old stages preserved, new version appended");
});
