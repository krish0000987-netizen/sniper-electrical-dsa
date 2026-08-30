/**
 * Growth Nations integration suite — boots the real app against a temporary DB,
 * seeds demo data, then verifies the loan distribution layer: lender network,
 * pipeline + mock lender mode, webhooks, commissions, payout batches, HR and
 * marketing attribution.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";
import type { Server } from "node:http";

const DB = path.join(tmpdir(), `nexus-gn-test-${process.pid}.db`);
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

test("GN dashboard aggregates from seeded records", async () => {
  const d = (await api("/gn/dashboard", { token: adminToken })).json;
  assert.ok(d.applications.total >= 37, "≥37 distribution applications");
  assert.ok(d.disbursement > 30000000, "disbursed > ₹3 Cr");
  assert.ok(d.commissions.gross > 0);
  assert.equal(d.receivable, d.commissions.gross - d.commissions.received, "receivable = earned − received");
  assert.ok(d.aging.length >= 3, "aging buckets populated");
  assert.equal(d.settings.partner_split_pct, 60, "60/40 split configured");
  assert.ok(d.byLender.length >= 5);
});

test("GN masters: lenders, products, schemes, DSA codes, partners, bankers", async () => {
  const lenders = (await api("/gn/lenders", { token: adminToken })).json;
  assert.ok(lenders.length >= 5);
  const products = (await api("/gn/products", { token: adminToken })).json;
  assert.ok(products.rows.length >= 15, "≥15 lender products");
  assert.ok(products.categories.length >= 8);
  const schemes = (await api("/gn/schemes", { token: adminToken })).json;
  assert.ok(schemes.length >= 15);
  assert.ok(schemes.some((s: any) => s.payout_type === "slab"), "slab scheme exists");
  const partners = (await api("/gn/partners", { token: adminToken })).json;
  assert.ok(partners.length >= 5);
  assert.ok(partners.some((p: any) => p.parent_name), "hierarchy exists");
  assert.ok((await api("/gn/dsa-codes", { token: adminToken })).json.length >= 5);
  assert.ok((await api("/gn/bankers", { token: adminToken })).json.length >= 5);
});

test("lender matching engine routes a customer profile to products", async () => {
  const m = (await api("/gn/match", { token: adminToken, method: "POST", body: { loan_type: "Business Loan", amount: 2500000, business_turnover: 20000000, business_vintage: 4, monthly_income: 150000 } })).json;
  assert.ok(m.matches.length > 0);
  const business = m.matches.filter((x: any) => x.category === "Business Loan");
  assert.ok(business.some((x: any) => x.status === "eligible" || x.status === "additional_docs"), "business products routed");
});

test("pipeline: create → advance → submit → mock lender → disbursement → commission", async () => {
  const products = (await api("/gn/products", { token: adminToken })).json.rows;
  const lenders = (await api("/gn/lenders", { token: adminToken })).json;
  const created = (await api("/gn/applications", { token: adminToken, method: "POST", body: { name: "GN Test Borrower", mobile: "9876500001", amount: 1500000, tenure: 36, product_id: products[0].id, lender_id: lenders[0].id, loan_type: "Business Loan" } })).json;
  assert.ok(created.ref.startsWith("GN-"));
  const adv = (await api(`/gn/applications/${created.id}/advance`, { token: adminToken, method: "POST" })).json;
  assert.equal(adv.status, "kyc_pending");
  const sub = (await api(`/gn/applications/${created.id}/submit`, { token: adminToken, method: "POST" })).json;
  assert.equal(sub.status, "submitted");
  for (const action of ["underwrite", "approve", "agreement"]) {
    const r = (await api(`/gn/applications/${created.id}/mock-lender`, { token: adminToken, method: "POST", body: { action } })).json;
    assert.ok(r.status, `mock action ${action} accepted`);
  }
  // The canonical 13-step journey: trigger → funds to borrower → confirm → CRM → reconcile
  const disb = (await api(`/gn/applications/${created.id}/mock-lender`, { token: adminToken, method: "POST", body: { action: "disburse", amount: 1500000 } })).json;
  assert.equal(disb.status, "disb_initiated", "disbursement triggered by lender");
  const fund = (await api(`/gn/applications/${created.id}/mock-lender`, { token: adminToken, method: "POST", body: { action: "fund", amount: 1500000 } })).json;
  assert.equal(fund.status, "disb_fully", "funds transferred to borrower's bank account");
  const conf = (await api(`/gn/applications/${created.id}/mock-lender`, { token: adminToken, method: "POST", body: { action: "confirm" } })).json;
  assert.equal(conf.status, "disb_confirmed");
  assert.ok(conf.commission_gross > 0, "commission auto-calculated on disbursement");
  const crm = (await api(`/gn/applications/${created.id}/mock-lender`, { token: adminToken, method: "POST", body: { action: "crm" } })).json;
  assert.equal(crm.status, "crm_updated", "Growth Nations CRM updated");
  const rec = (await api(`/gn/applications/${created.id}/mock-lender`, { token: adminToken, method: "POST", body: { action: "reconcile" } })).json;
  assert.equal(rec.status, "commission_reconciled", "commission / payout reconciliation");
  const detail = await api(`/gn/applications/${created.id}`, { token: adminToken });
  assert.ok(detail.json.timeline.length >= 12, "timeline records every event");
  const events = detail.json.timeline.map((t: any) => t.event);
  for (const step of ["DISBURSEMENT TRIGGERED BY LENDER", "FUNDS TRANSFERRED TO BORROWER", "DISBURSEMENT CONFIRMED", "GROWTH NATIONS CRM UPDATED", "COMMISSION / PAYOUT RECONCILED"]) {
    assert.ok(events.includes(step), `timeline has ${step}`);
  }
  assert.ok(detail.json.commission.id > 0, "commission record attached");
});

test("lender webhook: unauthenticated, idempotent, updates status + commission", async () => {
  const lenders = (await api("/gn/lenders", { token: adminToken })).json;
  const row = (await api("/gn/applications?limit=1", { token: adminToken })).json.rows[0];
  const wh = async (utr: string) => api(`/gn/webhooks/lender/${lenders[0].id}`, { method: "POST", body: { app_ref: row.ref, event: "PAYOUT_RECEIVED", utr } });
  const first = await wh("UTR-WH-1");
  assert.equal(first.status, 200, "webhook works without a session token");
  assert.equal(first.json.ok, true);
  const second = await wh("UTR-WH-2");
  assert.equal(second.json.duplicate, true, "duplicate webhook event ignored");
  const detail = await api(`/gn/applications/${row.id}`, { token: adminToken });
  assert.equal(detail.status, 200);
});

test("finance: income ledger, receivable aging, payout batches with 60/40 splits", async () => {
  const income = (await api("/gn/finance/income", { token: adminToken })).json;
  assert.ok(income.totals.received > 0, "received commissions exist");
  assert.ok(income.totals.tds > 0);
  const recv = (await api("/gn/finance/receivable", { token: adminToken })).json;
  assert.equal(Object.values(recv.buckets).reduce((a: any, b: any) => a + b, 0), recv.total, "aging buckets reconcile");
  const payouts = (await api("/gn/finance/payouts", { token: adminToken })).json;
  assert.ok(payouts.rows.length >= 3);
  assert.ok(payouts.totals.paid > 0, "a paid batch exists");
  // compute + create + approve a new batch
  const apps = (await api("/gn/applications?limit=200", { token: adminToken })).json.rows;
  const disbursed = apps.find((a: any) => a.commission_gross > 0);
  assert.ok(disbursed);
  const partners = (await api("/gn/partners", { token: adminToken })).json;
  const comp = (await api("/gn/finance/payouts/compute", { token: adminToken, method: "POST", body: { payee_type: "Partner", payee_id: partners[0].id, payee_name: partners[0].name, app_ids: [disbursed.id] } })).json;
  assert.equal(comp.splits.split_pct, 60);
  assert.ok(comp.splits["Growth Nations"] > 0);
  const pb = (await api("/gn/finance/payouts", { token: adminToken, method: "POST", body: { payee_type: "Partner", payee_id: partners[0].id, payee_name: partners[0].name, app_ids: [disbursed.id], mode: "NEFT" } })).json;
  assert.equal(pb.status, "draft");
  const paid = (await api(`/gn/finance/payouts/${pb.id}`, { token: adminToken, method: "PATCH", body: { status: "paid", mode: "NEFT", utr: "UTR-GN-TEST" } })).json;
  assert.equal(paid.status, "paid");
  assert.equal(paid.utr, "UTR-GN-TEST");
  // accounting reflects income/expense/payout
  const acct = (await api("/gn/finance/accounting", { token: adminToken })).json;
  assert.ok(acct.income > 0 && acct.expenses > 0 && typeof acct.netProfit === "number");
  assert.ok((await api("/gn/finance/fees", { token: adminToken })).json.rows.length > 0);
  const expenseRows = (await api("/gn/finance/expenses", { token: adminToken })).json.rows;
  assert.ok(expenseRows.length >= 14, `expenses seeded incl. pending claims (got ${expenseRows.length})`);
  assert.ok(expenseRows.some((e: any) => e.status === "pending"), "pending expense/conveyance claims exist for the approvals hub");
  assert.ok(expenseRows.some((e: any) => e.claim_type === "conveyance"), "conveyance claims exist");
});

test("HR + marketing + documents modules", async () => {
  assert.ok((await api("/gn/hr/leave", { token: adminToken })).json.length >= 5);
  const att = (await api("/gn/hr/attendance", { token: adminToken })).json;
  assert.ok(att.rows.length > 50 && att.summary.length > 0);
  const payroll = (await api("/gn/hr/payroll", { token: adminToken })).json;
  assert.ok(payroll.length >= 5 && payroll.every((p: any) => p.net > 0), "payroll generated with positive net");
  assert.equal((await api("/gn/hr/recruitment", { token: adminToken })).json.length, 5);
  const campaigns = (await api("/gn/campaigns", { token: adminToken })).json;
  assert.ok(campaigns.rows.length >= 5 && campaigns.totals.roi > 0);
  const docs = (await api("/gn/documents", { token: adminToken })).json;
  assert.ok(docs.rows.length > 0 && docs.summary.length > 0);
});

test("cross-selling pool + direct booking + RBAC", async () => {
  const xs = (await api("/gn/cross-selling", { token: adminToken })).json;
  assert.ok(xs.poolSize >= 1, "cohort aged 12+ months exists");
  const lenders = (await api("/gn/lenders", { token: adminToken })).json;
  const dbk = (await api("/gn/direct-bookings", { token: adminToken, method: "POST", body: { name: "Direct Booking Test", amount: 2500000, tenure: 36, dsa_code: "SBIDSA0421", lender_id: lenders[0].id, product_id: (await api("/gn/products", { token: adminToken })).json.rows[0].id } })).json;
  assert.ok(dbk.commission_gross > 0, "direct booking earns commission");
  // RBAC: customer blocked from GN endpoints
  assert.equal((await api("/gn/dashboard", { token: customerToken })).status, 403);
  assert.equal((await api("/gn/finance/income", { token: customerToken })).status, 403);
  assert.equal((await api("/gn/utility/overview", { token: customerToken })).status, 403);
});

test("utility: hub overview, claim approvals & bulk lead assign", async () => {
  const ov = (await api("/gn/utility/overview", { token: adminToken })).json;
  assert.ok(ov.claimsPending >= 6, "pending expense/conveyance claims seeded");
  assert.ok(ov.leavePending >= 1, "pending leave seeded");
  assert.ok(ov.leads >= 1000 && ov.leadsOpen > 0 && ov.team > 50);
  // approve a pending claim → audit trail + status change
  const exp = (await api("/gn/finance/expenses", { token: adminToken })).json.rows;
  const pending = exp.find((e: any) => e.status === "pending");
  assert.ok(pending);
  const approved = (await api(`/gn/finance/expenses/${pending.id}`, { token: adminToken, method: "PATCH", body: { status: "approved" } })).json;
  assert.equal(approved.status, "approved");
  // bulk lead assign: dry-run preview then confirm
  const team = (await api("/gn/team", { token: adminToken })).json;
  const target = team.find((u: any) => u.role === "sales_manager" || u.role === "telecaller") ?? team[0];
  const preview = (await api("/gn/utility/leads/assign", { token: adminToken, method: "POST", body: { status: "interested", state: "Maharashtra", target_user_id: target.id, dry_run: true } })).json;
  assert.ok(preview.dryRun === true && typeof preview.count === "number");
  const run = (await api("/gn/utility/leads/assign", { token: adminToken, method: "POST", body: { status: "interested", state: "Maharashtra", target_user_id: target.id } })).json;
  assert.equal(run.assigned, preview.count, "confirm assigns exactly the previewed leads");
  // leave approve
  const leave = (await api("/gn/hr/leave", { token: adminToken })).json;
  const lv = leave.find((l: any) => l.status === "pending");
  if (lv) {
    const done = (await api(`/gn/hr/leave/${lv.id}`, { token: adminToken, method: "PATCH", body: { status: "approved" } })).json;
    assert.equal(done.status, "approved");
  }
});

test("marketing: workflows + IVR menus + simulated calls", async () => {
  const wfs = (await api("/gn/workflows", { token: adminToken })).json;
  assert.ok(wfs.rows.length >= 4, `workflows seeded (${wfs.rows.length})`);
  assert.ok(wfs.rows.some((w: any) => w.status === "active"), "active workflow exists");
  const created = (await api("/gn/workflows", { token: adminToken, method: "POST", body: { name: "Test Workflow", trigger: "lead_captured", route: "round_robin", actions: [{ type: "task", title: "Call" }] } })).json;
  assert.ok(created.id > 0);
  const run = (await api(`/gn/workflows/${created.id}/run`, { token: adminToken, method: "POST" })).json;
  assert.equal(run.ok, true);
  assert.ok(run.enqueued >= 1, "workflow run enqueues inbox messages/tasks");
  const menus = (await api("/gn/ivr/menus", { token: adminToken })).json;
  assert.ok(menus.length >= 3, `ivr menus seeded (${menus.length})`);
  const sim = (await api("/gn/ivr/calls", { token: adminToken, method: "POST", body: { ivr_menu_id: menus[0].id, option: "1" } })).json;
  assert.ok(sim.call_id && sim.route, "simulated call routes to a team");
  const calls = (await api("/gn/ivr/calls", { token: adminToken })).json;
  assert.ok(calls.rows.length >= 19, `call logs seeded + simulated (${calls.rows.length})`);
  assert.ok(calls.summary.some((s: any) => s.outcome === "connected"));
});

test("inbox: messages, templates, drips + drip send", async () => {
  const inbox = (await api("/gn/inbox", { token: adminToken })).json;
  assert.ok(inbox.rows.length >= 15, `inbox messages seeded (${inbox.rows.length})`);
  assert.ok(inbox.summary.some((s: any) => s.status === "unread"), "unread messages exist");
  const sent = (await api("/gn/inbox", { token: adminToken, method: "POST", body: { direction: "out", channel: "whatsapp", to_contact: "9999999999", body: "Test message", status: "sent" } })).json;
  assert.ok(sent.id > 0);
  const tpls = (await api("/gn/inbox/templates", { token: adminToken })).json;
  assert.ok(tpls.rows.length >= 8, `templates seeded (${tpls.rows.length})`);
  const drips = (await api("/gn/inbox/drips", { token: adminToken })).json;
  assert.ok(drips.rows.length >= 4, `drips seeded (${drips.rows.length})`);
  const dripsSent = (await api(`/gn/inbox/drips/${drips.rows[0].id}/send`, { token: adminToken, method: "POST" })).json;
  assert.ok(dripsSent.ok === true && dripsSent.sent >= 1, "drip send enqueues messages");
  // mark-read round trip
  const unread = inbox.rows.find((m: any) => m.status === "unread");
  if (unread) {
    const marked = (await api(`/gn/inbox/${unread.id}`, { token: adminToken, method: "PATCH", body: { status: "read" } })).json;
    assert.equal(marked.status, "read");
  }
});

test("docs + help: articles, faqs, support tickets", async () => {
  const docs = (await api("/gn/docs", { token: adminToken })).json;
  assert.ok(docs.rows.length >= 8, `articles seeded (${docs.rows.length})`);
  assert.ok(docs.categories.length >= 4, "multiple doc categories");
  const faqs = (await api("/gn/faqs", { token: adminToken })).json;
  assert.ok(faqs.rows.length >= 10, `faqs seeded (${faqs.rows.length})`);
  const voted = (await api(`/gn/faqs/${faqs.rows[0].id}`, { token: adminToken, method: "PATCH", body: { helpful_yes: true } })).json;
  assert.ok((voted.helpful_yes ?? 0) >= 1, "helpful vote increments");
  const tickets = (await api("/gn/support/tickets", { token: adminToken })).json;
  assert.ok(tickets.rows.length >= 6, `tickets seeded (${tickets.rows.length})`);
  const raised = (await api("/gn/support/tickets", { token: adminToken, method: "POST", body: { subject: "Test ticket", message: "Testing the ticket flow", priority: "high", category: "Bug" } })).json;
  assert.ok(raised.id > 0);
  const updated = (await api(`/gn/support/tickets/${raised.id}`, { token: adminToken, method: "PATCH", body: { status: "resolved", resolution: "Fixed in test" } })).json;
  assert.equal(updated.status, "resolved");
});

test("changelog + recycle bin: delete-to-trash, restore, purge", async () => {
  const cl = (await api("/gn/changelog", { token: adminToken })).json;
  assert.ok(cl.rows.length >= 8, `changelog seeded (${cl.rows.length})`);
  const added = (await api("/gn/changelog", { token: adminToken, method: "POST", body: { version: "9.9.9", title: "Trash test release", content: "x", category: "fix" } })).json;
  assert.ok(added.id > 0);
  // delete-to-trash round trip on a campaign
  const campaigns = (await api("/gn/campaigns", { token: adminToken })).json;
  const victim = campaigns.rows[0];
  const del = await api(`/gn/campaigns/${victim.id}`, { token: adminToken, method: "DELETE" });
  assert.equal(del.status, 200);
  const trash = (await api("/gn/trash", { token: adminToken })).json;
  const inBin = trash.rows.find((r: any) => r.entity_type === "campaign" && r.entity_id === victim.id);
  assert.ok(inBin, "deleted campaign sits in the recycle bin");
  assert.ok(trash.summary.some((s: any) => s.entity_type === "campaign"));
  // restore it — same id comes back
  const restored = (await api(`/gn/trash/${inBin.id}/restore`, { token: adminToken, method: "POST" })).json;
  assert.equal(restored.ok, true);
  const after = (await api("/gn/campaigns", { token: adminToken })).json;
  assert.ok(after.rows.some((c: any) => c.id === victim.id), "campaign restored with original id");
  // purge the changelog entry added above
  await api(`/gn/changelog/${added.id}`, { token: adminToken, method: "DELETE" });
  const trash2 = (await api("/gn/trash", { token: adminToken })).json;
  const bin = trash2.rows.find((r: any) => r.entity_type === "changelog" && r.entity_id === added.id);
  assert.ok(bin, "changelog entry delete lands in trash");
  const purged = await api(`/gn/trash/${bin.id}`, { token: adminToken, method: "DELETE" });
  assert.equal(purged.status, 200);
  const gone = (await api("/gn/trash", { token: adminToken })).json;
  assert.ok(!gone.rows.some((r: any) => r.id === bin.id), "purged item removed permanently");
  // RBAC: customer blocked from inbox + trash
  assert.equal((await api("/gn/inbox", { token: customerToken })).status, 403);
  assert.equal((await api("/gn/trash", { token: customerToken })).status, 403);
});
