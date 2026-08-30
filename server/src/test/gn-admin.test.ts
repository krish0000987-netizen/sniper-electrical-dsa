/**
 * GN admin suite — covers the admin-toggable Roles & Permissions grid, settings
 * (company / API keys / HR policies), the extended Add Scheme engine, Matcher V2,
 * and CSV import/export. Runs against a fresh temporary DB with the real app.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";
import type { Server } from "node:http";

const DB = path.join(tmpdir(), `nexus-gn-admin-test-${process.pid}.db`);
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

test("current user payload drives role-based dashboards", async () => {
  const me = (await api("/gn/admin/me", { token: adminToken })).json;
  assert.equal(me.role, "super_admin");
  assert.ok(me.perms.length >= 80, `admin has full grid (${me.perms.length})`);
  assert.ok(me.perms.includes("gn.finance.view"));
  assert.ok(me.perms.includes("gn.settings.manage"));
  const dsaMe = (await api("/gn/admin/me", { token: dsaToken })).json;
  assert.equal(dsaMe.kind, "partner");
  assert.ok(!dsaMe.perms.includes("gn.finance.view"), "dsa has no finance by default");
});

test("permission grid: admin toggles a role's module and it is enforced on the API", async () => {
  const roles = (await api("/gn/admin/roles", { token: adminToken })).json.roles;
  assert.ok(roles.length >= 16, "all system roles seeded");
  const dsaRole = roles.find((r: any) => r.code === "dsa");
  assert.ok(dsaRole && dsaRole.kind === "partner");

  // Baseline: dsa cannot already see finance
  assert.equal((await api("/gn/finance/income", { token: dsaToken })).status, 403);

  // Grant Finance.view to dsa, verify access, then revoke
  const grid = (await api(`/gn/admin/roles/${dsaRole.id}/permissions`, { token: adminToken })).json.grid;
  const rows: { module: string; action: string; allowed: boolean; scope: string }[] = [];
  for (const m of Object.keys(grid)) {
    for (const a of Object.keys(grid[m])) {
      rows.push({ module: m, action: a, allowed: m === "Finance" && a === "view" ? true : grid[m][a].allowed, scope: grid[m][a].scope });
    }
  }
  const save = await api(`/gn/admin/roles/${dsaRole.id}/permissions`, { token: adminToken, method: "POST", body: { rows } });
  assert.equal(save.status, 200);
  const afterGrant = await api("/gn/finance/income", { token: dsaToken });
  assert.equal(afterGrant.status, 200, "dsa can see finance after grant");

  // Revoke again → denied
  const revoke = await api(`/gn/admin/roles/${dsaRole.id}/permissions`, {
    token: adminToken, method: "POST",
    body: { rows: rows.map((r) => (r.module === "Finance" ? { ...r, allowed: false } : r)) }
  });
  assert.equal(revoke.status, 200);
  assert.equal((await api("/gn/finance/income", { token: dsaToken })).status, 403, "denied after revoke");
});

test("custom roles: create empty, assign permissions, delete", async () => {
  const created = (await api("/gn/admin/roles", { token: adminToken, method: "POST", body: { name: "Verification Analyst", kind: "staff", designation: "Operations" } })).json;
  assert.ok(created.id > 0);
  const grid = (await api(`/gn/admin/roles/${created.id}/permissions`, { token: adminToken })).json.grid;
  const allOff = Object.values(grid).every((m: any) => Object.values(m).every((c: any) => !c.allowed));
  assert.ok(allOff, "custom role starts with empty permissions");
  const del = await api(`/gn/admin/roles/${created.id}`, { token: adminToken, method: "DELETE" });
  assert.equal(del.status, 200);
  // system roles cannot be deleted
  const system = (await api("/gn/admin/roles", { token: adminToken })).json.roles.find((r: any) => r.code === "super_admin");
  assert.equal((await api(`/gn/admin/roles/${system.id}`, { token: adminToken, method: "DELETE" })).status, 400);
});

test("settings: company/invoice, API keys, leave types, holidays, office timings", async () => {
  const s = (await api("/gn/admin/settings", { token: adminToken })).json;
  assert.ok(s.gn_company?.gstin, "company GSTIN seeded");
  assert.equal(s.gn_office_timings?.start, "09:30");
  assert.ok(s.gn_leave_types.length >= 5);
  assert.ok(s.gn_holidays.length >= 8);
  assert.ok(s.gn_reseller?.brand_name);
  assert.ok(s.gn_roles_count >= 16);

  // Save a company change
  const save = await api("/gn/admin/settings", { token: adminToken, method: "POST", body: { key: "gn_company", value: { ...s.gn_company, name: "Test Co Pvt Ltd" } } });
  assert.equal(save.status, 200);
  const after = (await api("/gn/admin/settings", { token: adminToken })).json;
  assert.equal(after.gn_company.name, "Test Co Pvt Ltd");

  // API keys masked + generate + revoke
  const keys = (await api("/gn/admin/api-keys", { token: adminToken })).json;
  assert.equal(keys.length, 2);
  assert.ok(keys.every((k: any) => k.key.includes("••")));
  const gen = await api("/gn/admin/api-keys", { token: adminToken, method: "POST", body: { label: "Test Key" } });
  assert.ok(gen.json.key.startsWith("gn_live_"));
  const keys2 = (await api("/gn/admin/api-keys", { token: adminToken })).json;
  assert.equal(keys2.length, 3);
  await api(`/gn/admin/api-keys/${keys2[0].id}`, { token: adminToken, method: "DELETE" });
  assert.equal((await api("/gn/admin/api-keys", { token: adminToken })).json.length, 2);
});

test("extended Add Scheme + Matcher V2", async () => {
  const lenders = (await api("/gn/lenders", { token: adminToken })).json;
  assert.ok(lenders.length >= 5);
  const created = await api("/gn/schemes", {
    token: adminToken, method: "POST",
    body: {
      lender_id: lenders[0].id, name: "Test — Salaried Scheme", profile: "Salaried", states: ["All India"],
      loan_params: { min_amount: 100000, max_amount: 3000000, min_tenure: 12, max_tenure: 60, roi_min: 10, roi_max: 13, processing_fee_pct: 1.5 },
      eligibility: { min_age: 21, max_age: 58, min_income: 25000, max_foir: 50, max_ltv: 75, min_credit_score: 700 },
      programs: ["Standard", "BT"], purposes: ["Personal"], usp: "test usp", commission_pct: 1.1,
      policy: { negative_list: ["CIBIL < 700"], cibil_required: true, notes: "test" }, source: "manual"
    }
  });
  assert.equal(created.status, 200, JSON.stringify(created.json).slice(0, 150));
  const detail = (await api(`/gn/schemes/${created.json.id}`, { token: adminToken })).json;
  assert.equal(detail.loan_params.min_amount, 100000);
  assert.equal(detail.eligibility.min_credit_score, 700);
  assert.equal(detail.profile, "Salaried");
  assert.equal(detail.source, "manual");

  const match = await api("/gn/match/v2", {
    token: adminToken, method: "POST",
    body: { amount: 500000, tenure: 36, loan_type: "Home Loan", employment_type: "Salaried", monthly_income: 60000, credit_score: 720, age: 32, state: "Maharashtra" }
  });
  assert.equal(match.status, 200);
  assert.ok(match.json.matches.length >= 5);
  assert.ok(match.json.matches.some((m: any) => m.status === "eligible"));
  assert.ok(match.json.matches.every((m: any) => typeof m.commission?.net === "number"));
  // A profile that should fail most schemes
  const bad = await api("/gn/match/v2", {
    token: adminToken, method: "POST",
    body: { amount: 500000, tenure: 36, loan_type: "Home Loan", monthly_income: 5000, credit_score: 300, age: 17, state: "Sikkim" }
  });
  assert.ok(bad.json.matches.length > 0);
  assert.ok(bad.json.matches.every((m: any) => m.status !== "eligible"), "unqualified profile gets no eligible offer (only not_eligible / maybe)");
});

test("import & export round trip (CSV)", async () => {
  const exp = await fetch(base + "/api/gn/export/applications", { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(exp.status, 200);
  const csv = await exp.text();
  assert.ok(csv.includes("GN-"), "export contains application refs");
  assert.ok(csv.includes("id,"), "export has header row");

  const imp = await api("/gn/import/lenders", { token: adminToken, method: "POST", body: { csv: "name,type,dsa_code\nRound Trip Bank,Bank,RTTEST001\n" } });
  assert.equal(imp.json.inserted, 1, JSON.stringify(imp.json));
  assert.equal(imp.json.errors.length, 0);

  const bad = await api("/gn/import/schemes", { token: adminToken, method: "POST", body: { csv: "name,lender_name\nMissing Lender Scheme,No Such Bank\n" } });
  assert.equal(bad.json.inserted, 0);
  assert.equal(bad.json.errors.length, 1, "unknown lender reported as error");
});

test("start-fresh clears transactional data but keeps masters", async () => {
  const before = (await api("/gn/dashboard", { token: adminToken })).json;
  assert.ok(before.applications.total >= 30);
  const reset = await api("/gn/admin/start-fresh", { token: adminToken, method: "POST" });
  assert.equal(reset.status, 200);
  assert.ok(reset.json.cleared.gn_applications >= 30, "applications cleared");
  const after = (await api("/gn/dashboard", { token: adminToken })).json;
  assert.equal(after.applications.total, 0, "dashboard empty after reset");
  const lenders = (await api("/gn/lenders", { token: adminToken })).json;
  assert.ok(lenders.length >= 5, "masters preserved");
});
