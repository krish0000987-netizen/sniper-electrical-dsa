/**
 * Integration Hub smoke test — `npm run test:hub`.
 *
 * Boots the real app on an ephemeral port against its own throwaway Postgres
 * schema (per-process isolation, same mechanism as the test suites), then
 * walks the Hub admin contract end to end:
 *
 *   1. state listing (rows + counts + env summary)
 *   2. mock ⇄ live mode switch on PAN Verification
 *   3. a real Test (Digitap probe when credentials exist, instant "not
 *      configured" otherwise — never a billable call)
 *   4. an enablement Test on an adapter Digitap has not enabled yet
 *
 * Exits non-zero on any failed assertion, so it can gate CI.
 */
import { tmpdir } from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";
import type { Server } from "node:http";

const DB = path.join(tmpdir(), `nexus-hub-smoke-${process.pid}.db`);
process.env.NEXUS_DB = DB;
process.env.NEXUS_PORT = "0";

let server: Server;
let base = "";
let token = "";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api<T = any>(pathname: string, opts: { method?: string; body?: unknown } = {}): Promise<{ status: number; json: T }> {
  const res = await fetch(base + "/api" + pathname, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, json };
}

interface HubRow {
  id: number;
  code: string;
  name: string;
  category: string;
  mode: string;
  effectiveStatus: string;
  driver: string;
  excluded?: boolean;
}
interface HubState {
  rows: HubRow[];
  counts: Record<string, number>;
  env: { provider: string; digitapEnv: string; digitapCredentials: string; note: string };
}

async function main() {
  const { createApp } = await import("../src/app.js");
  const app = await createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 8787}`;

  const login = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@nexus.demo", password: "demo1234" })
  });
  const loginJson = (await login.json()) as { token?: string };
  check("login as admin@nexus.demo", login.ok && !!loginJson.token);
  if (!loginJson.token) return;
  token = loginJson.token;

  // 1. State listing
  const state = await api<HubState>("/admin/integrations");
  check("GET /admin/integrations → 200", state.status === 200);
  check("20 adapters listed", state.json.rows?.length === 20, `got ${state.json.rows?.length}`);
  const countKeys = ["connected", "sandbox", "error", "not_configured", "awaiting_enablement"];
  check("counts object complete", countKeys.every((k) => typeof state.json.counts?.[k] === "number"));
  const total = Object.values(state.json.counts ?? {}).reduce((a, b) => a + b, 0);
  check("counts reconcile to 20", total === 20, `sum=${total}`);
  check("env summary present", typeof state.json.env?.provider === "string" && typeof state.json.env?.note === "string");
  const pan = state.json.rows?.find((r) => r.code === "pan_verify");
  check("PAN Verification row present", !!pan, pan ? "" : "missing code pan_verify");
  check("PAN row driven by the digitap adapter", pan?.driver === "digitap", `driver=${pan?.driver}`);
  check("PAN row starts in mock mode", pan?.mode === "mock", `mode=${pan?.mode}`);
  const excluded = state.json.rows?.filter((r) => r.excluded);
  check("Payments/Communication adapters excluded from live scope", excluded?.length === 6, `excluded=${excluded?.length}`);

  // 2. Mode switch
  if (pan) {
    const live = await api("/admin/integrations/" + pan.id, { method: "PATCH", body: { mode: "live" } });
    check("PATCH mode=live → 200", live.status === 200);
    check("row reports live mode", (live.json as HubRow).mode === "live", `mode=${(live.json as HubRow).mode}`);
    const back = await api("/admin/integrations/" + pan.id, { method: "PATCH", body: { mode: "mock" } });
    check("PATCH back to mock", back.status === 200 && (back.json as HubRow).mode === "mock");
  }

  // 3. Real Test on PAN Verification (probe; non-billable by construction)
  if (pan) {
    const t = await api<{ ok: boolean; message: string; latencyMs: number }>(
      "/admin/integrations/" + pan.id + "/test",
      { method: "POST", body: {} }
    );
    check("POST test → 200", t.status === 200);
    check("test returns a boolean ok", typeof t.json.ok === "boolean", `ok=${String(t.json.ok)}`);
    check("test returns a message", typeof t.json.message === "string" && t.json.message.length > 0);
    check("test reports latency", typeof t.json.latencyMs === "number" && t.json.latencyMs >= 0, `latency=${t.json.latencyMs}`);
  }

  // 4. Enablement test on a suite Digitap has not enabled (no network call)
  const cibil = state.json.rows?.find((r) => r.code === "cibil");
  if (cibil) {
    const t = await api<{ ok: boolean; message: string }>("/admin/integrations/" + cibil.id + "/test", {
      method: "POST",
      body: {}
    });
    check("CIBIL test reports awaiting enablement", t.status === 200 && t.json.ok === false && /awaiting/i.test(t.json.message), t.json.message);
  }

  console.log(`\nhub smoke: ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((err) => {
    console.error("hub smoke crashed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    server?.close();
    rmSync(DB, { force: true });
    rmSync(DB + "-wal", { force: true });
    rmSync(DB + "-shm", { force: true });
  });
