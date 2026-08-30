/**
 * GN Bulk engine suite — batch creation, CSV upload with auto column mapping,
 * validation, duplicate detection, preview, processing and exports.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";
import type { Server } from "node:http";

const DB = path.join(tmpdir(), `nexus-gn-bulk-test-${process.pid}.db`);
process.env.NEXUS_DB = DB;
process.env.NEXUS_PORT = "0";

let server: Server;
let base = "";
let adminToken = "";

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

const CSV = [
  "Applicant Name,Mobile Number,PAN Number,Loan Type,Loan Amount,Annual Turnover,Business Vintage,Monthly Income,City",
  "Rahul Sharma,9811111111,ABCDE1234F,Business Loan,2500000,24000000,5,200000,Ahmedabad",
  "Priya Shah,9822222222,BMPRS2345G,Personal Loan,800000,,,95000,Mumbai",
  "Amit Patel,9833333333,INVALIDPAN,Home Loan,6000000,,,300000,Delhi",
  "Sneha Reddy,9844444444,BMPRT3456H,Business Loan,1800000,15000000,3,150000,Pune",
  "Duplicate Row,9811111111,ZZZZZ1234X,Business Loan,1000000,5000000,1,80000,Mumbai",
  "Bad Row 1,999,AAAAA1111A,Personal Loan,100000,,,40000,Jaipur"
].join("\n");

before(async () => {
  const { createApp } = await import("../app.js");
  const app = await createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 8787}`;
  adminToken = await login("admin@nexus.demo");
});

after(() => {
  server?.close();
  rmSync(DB, { force: true });
  rmSync(DB + "-wal", { force: true });
  rmSync(DB + "-shm", { force: true });
});

test("create batch, upload CSV, auto-map, validate, dedupe, preview, process, export", async () => {
  const b = await api("/gn/bulk/batches", {
    method: "POST", token: adminToken,
    body: { name: "Test Bulk Batch", source: "DSA", loan_type: "Mixed", priority: "high" }
  });
  assert.equal(b.status, 200);
  const batchId = b.json.id;

  // Upload — CSV auto-maps Applicant Name → name, Mobile Number → mobile, PAN Number → pan…
  const up = await api(`/gn/bulk/batches/${batchId}/upload`, {
    method: "POST", token: adminToken, body: { filename: "leads.csv", data: Buffer.from(CSV).toString("base64") }
  });
  assert.equal(up.status, 200);
  assert.equal(up.json.rows, 6);
  assert.ok(up.json.mapping.name !== undefined, "Applicant Name auto-mapped");
  assert.ok(up.json.mapping.mobile !== undefined, "Mobile Number auto-mapped");
  assert.ok(up.json.mapping.pan !== undefined, "PAN Number auto-mapped");

  // Validate — 4 valid, 2 invalid (bad PAN, bad mobile)
  const val = await api(`/gn/bulk/batches/${batchId}/validate`, { method: "POST", token: adminToken, body: {} });
  assert.equal(val.status, 200);
  assert.equal(val.json.valid, 4);
  assert.equal(val.json.invalid, 2);

  // Dedupe — one row duplicates an earlier mobile within the batch
  const dup = await api(`/gn/bulk/batches/${batchId}/dedupe`, { method: "POST", token: adminToken, body: {} });
  assert.equal(dup.status, 200);
  const detail = await api(`/gn/bulk/batches/${batchId}?limit=100`, { token: adminToken });
  const dupRow = detail.json.rows.find((r: any) => r.status === "duplicate");
  assert.ok(dupRow, "duplicate row detected");
  assert.match(dupRow.error ?? "", /same mobile/i);

  // Preview
  const preview = await api(`/gn/bulk/batches/${batchId}/preview`, { method: "POST", token: adminToken, body: {} });
  assert.equal(preview.status, 200);
  assert.ok(preview.json.byStatus.some((s: any) => s.status === "valid" && s.n >= 2));

  // Process — the 3 valid non-duplicate rows go through the pipeline
  const proc = await api(`/gn/bulk/batches/${batchId}/process`, { method: "POST", token: adminToken, body: {} });
  assert.equal(proc.status, 200);
  assert.ok(proc.json.created >= 3, "applicants created");
  const after = await api(`/gn/bulk/batches/${batchId}?limit=100`, { token: adminToken });
  assert.equal(after.json.batch.status, "completed");
  assert.ok(after.json.batch.applicants_created >= 3, "batch counters updated from DB");

  // Export
  const exp = await api(`/gn/bulk/batches/${batchId}/export`, { method: "POST", token: adminToken, body: { filter: "" } });
  assert.equal(exp.status, 200);
});

test("column re-mapping endpoint updates row mapping", async () => {
  const b = await api("/gn/bulk/batches", { method: "POST", token: adminToken, body: { name: "Map Test Batch" } });
  const batchId = b.json.id;
  await api(`/gn/bulk/batches/${batchId}/upload`, {
    method: "POST", token: adminToken,
    body: { filename: "x.csv", data: Buffer.from("Name,Mobile,Loan Required\nKunal Desai,9855555555,2000000").toString("base64") }
  });
  const mapped = await api(`/gn/bulk/batches/${batchId}/map`, {
    method: "POST", token: adminToken, body: { mapping: { name: 0, mobile: 1, loan_amount: 2 } }
  });
  assert.equal(mapped.status, 200);
  const detail = await api(`/gn/bulk/batches/${batchId}?limit=10`, { token: adminToken });
  const row = detail.json.rows[0];
  assert.equal(JSON.parse(row.mapped).loan_amount, "2000000");
});

test("in-browser row correction revalidates a single row", async () => {
  const b = await api("/gn/bulk/batches", { method: "POST", token: adminToken, body: { name: "Correction Test" } });
  const batchId = b.json.id;
  await api(`/gn/bulk/batches/${batchId}/upload`, {
    method: "POST", token: adminToken,
    body: { filename: "y.csv", data: Buffer.from("Name,Mobile,Loan Amount\nVikram Singh,9866666666,100000").toString("base64") }
  });
  const val = await api(`/gn/bulk/batches/${batchId}/validate`, { method: "POST", token: adminToken, body: {} });
  assert.equal(val.json.valid, 1);
  // Break a row, then fix it in-browser
  await api(`/gn/bulk/batches/${batchId}/map`, { method: "POST", token: adminToken, body: { mapping: { name: 0, mobile: 2, loan_amount: 1 } } });
  const val2 = await api(`/gn/bulk/batches/${batchId}/validate`, { method: "POST", token: adminToken, body: {} });
  assert.equal(val2.json.invalid, 1, "swapped columns now invalid");
  const detail = await api(`/gn/bulk/batches/${batchId}?limit=10`, { token: adminToken });
  const rowId = detail.json.rows[0].id;
  const fixed = await api(`/gn/bulk/rows/${rowId}`, { method: "PATCH", token: adminToken, body: { mapped: { mobile: "9866666666", loan_amount: "100000" } } });
  assert.equal(fixed.json.status, "valid", "row revalidates after correction");
});

test("demo bulk batch loads 500 rows with validation, duplicates and full processing", async () => {
  const r = await api("/gn/bulk/demo", { method: "POST", token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.json.rows, 500);
  assert.ok(r.json.valid >= 380, `majority valid (${r.json.valid})`);
  assert.ok(r.json.duplicates >= 8, `duplicates detected (${r.json.duplicates})`);
  assert.ok(r.json.invalid >= 8, `invalid rows flagged (${r.json.invalid})`);
  assert.ok(r.json.processing.created >= 350, `applicants created from valid rows (${r.json.processing.created})`);
  assert.ok(r.json.processing.disbursed >= 80, `disbursements recorded (${r.json.processing.disbursed})`);
  const detail = await api(`/gn/bulk/batches/${r.json.batchId}?limit=10`, { token: adminToken });
  assert.equal(detail.json.batch.status, "completed");
  assert.ok(detail.json.batch.disbursed_amount > 0, "disbursed amount tracked");
  assert.ok(detail.json.errors.length > 0, "error center populated with recommendations");
});

test("RBAC: DSA cannot create or view bulk batches", async () => {
  const dsa = await login("dsa@nexus.demo");
  const list = await api("/gn/bulk", { token: dsa });
  assert.equal(list.status, 403);
  const create = await api("/gn/bulk/batches", { method: "POST", token: dsa, body: { name: "x" } });
  assert.equal(create.status, 403);
});
