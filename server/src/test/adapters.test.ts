import { test } from "node:test";
import assert from "node:assert/strict";
import { translateSql } from "../db/connection.js";
import {
  normalizePan, maskPan, toDigitapDob, PAN_REGEX,
  digitapConfig, digitapBaseUrl, DigitapError
} from "../adapters/digitap.js";
import { ADAPTER_CATALOG, CATALOG_BY_CODE } from "../adapters/types.js";
import { buildIntegrationView, effectiveStatusOf, parseRowConfig } from "../adapters/registry.js";

function row(over: Record<string, any> = {}) {
  return {
    id: 1, tenant_id: 1, code: "pan_verify", name: "PAN Verification", category: "identity",
    provider: "MOCK-PAN_VERIFY", status: "sandbox", config: null, ...over
  };
}

test("PAN utilities: normalize, mask, regex, dob formats", () => {
  assert.equal(normalizePan(" abcpe1234f "), "ABCPE1234F");
  assert.equal(maskPan("ABCPE1234F"), "ABCP****4F");
  assert.equal(maskPan("xyz"), "*****");
  assert.ok(PAN_REGEX.test("ABCPE1234F"));
  assert.ok(!PAN_REGEX.test("ABCPE12345"));
  assert.equal(toDigitapDob("1992-09-02"), "02/09/1992");
  assert.equal(toDigitapDob("2/9/1992"), "02/09/1992");
  assert.equal(toDigitapDob(null), null);
});

test("catalog integrity: 20 adapters, no duplicate codes, PAN driver = digitap", () => {
  assert.equal(ADAPTER_CATALOG.length, 20);
  const codes = ADAPTER_CATALOG.map((a) => a.code);
  assert.equal(new Set(codes).size, 20);
  assert.ok(ADAPTER_CATALOG.filter((a) => a.excluded).length >= 6); // payments + communication
  assert.equal(CATALOG_BY_CODE.get("pan_verify")?.driver, "digitap");
  assert.equal(CATALOG_BY_CODE.get("pan_verify")?.digitap?.enabled, true);
  // No adapter claims a live driver Digitap has not enabled for this client yet.
  for (const a of ADAPTER_CATALOG) {
    if (a.driver === "digitap") assert.ok(a.digitap?.enabled, `${a.code} driver digitap requires enablement`);
  }
});

test("effective status is computed, never fabricated by config alone", () => {
  const adapter = CATALOG_BY_CODE.get("pan_verify")!;
  // default sandbox
  assert.equal(effectiveStatusOf(row(), adapter, true), "sandbox");
  // live mode + no credentials → not configured (nothing to call)
  assert.equal(effectiveStatusOf(row({ config: JSON.stringify({ mode: "live" }) }), adapter, false), "not_configured");
  // live mode + creds but no passing probe → awaiting (never claims connected)
  assert.equal(effectiveStatusOf(row({ config: JSON.stringify({ mode: "live" }) }), adapter, true), "awaiting_enablement");
  // only a PASSING probe turns it connected
  assert.equal(effectiveStatusOf(row({ config: JSON.stringify({ mode: "live", lastTestOk: true }) }), adapter, true), "connected");
  assert.equal(effectiveStatusOf(row({ config: JSON.stringify({ mode: "live", lastTestOk: false }) }), adapter, true), "error");
  // excluded scope → not_configured even when live requested
  const upi = CATALOG_BY_CODE.get("upi")!;
  assert.equal(effectiveStatusOf(row({ code: "upi", config: JSON.stringify({ mode: "live" }) }), upi, true), "not_configured");
  // a non-enabled Digitap suite can never be connected
  const experian = CATALOG_BY_CODE.get("experian")!;
  assert.equal(effectiveStatusOf(row({ code: "experian", config: JSON.stringify({ mode: "live" }) }), experian, true), "awaiting_enablement");
  assert.ok(["connected", "sandbox", "awaiting_enablement", "error", "not_configured"].includes(
    effectiveStatusOf(row({ code: "experian" }), experian, false)));
});

test("buildIntegrationView exposes only safe fields", () => {
  const v = buildIntegrationView(row());
  assert.equal(v.code, "pan_verify");
  assert.equal(v.effectiveStatus, "sandbox");
  assert.equal(v.excluded, false);
  assert.equal(v.mode, "mock");
  assert.equal(v.digitapProduct, "PAN Basic (V1/V2)");
  assert.deepEqual(Object.keys(v).sort(), [
    "category", "code", "credentialsConfigured", "digitapEnabled", "digitapFamily",
    "digitapProduct", "driver", "effectiveStatus", "excluded", "id", "mode",
    "name", "needsConsent", "note", "provider", "scope", "status"
  ].sort());
});

test("digitap config/env helpers", () => {
  const before = { ...process.env };
  delete process.env.DIGITAP_UAT_CLIENT_ID;
  delete process.env.DIGITAP_UAT_CLIENT_SECRET;
  delete process.env.DIGITAP_PROD_CLIENT_ID;
  delete process.env.DIGITAP_PROD_CLIENT_SECRET;
  process.env.DIGITAP_ENV = "uat";
  assert.equal(digitapConfig().creds, null);
  process.env.DIGITAP_UAT_CLIENT_ID = "cid";
  process.env.DIGITAP_UAT_CLIENT_SECRET = "csec";
  assert.equal(digitapConfig().creds?.clientId, "cid");
  assert.equal(digitapBaseUrl("uat"), "https://svcdemo.digitap.work");
  assert.equal(digitapBaseUrl("prod"), "https://svc.digitap.ai");
  process.env = { ...before };
});

test("DigitapError carries http status + result code", () => {
  const e = new DigitapError(200, "No record found", 103);
  assert.equal(e.httpStatus, 200);
  assert.equal(e.resultCode, 103);
  assert.equal(e.message, "No record found");
});

test("translateSql: date('now') → CURRENT_DATE, datetime → CURRENT_TIMESTAMP", () => {
  const s = translateSql("SELECT * FROM x WHERE date(created_at) = date('now') AND created_at <= datetime('now')");
  assert.ok(s.includes("CURRENT_DATE"));
  assert.ok(!/date\('now'\)/i.test(s));
  assert.ok(s.includes("CURRENT_TIMESTAMP"));
});

test("translateSql: date('now','-30 days') → CURRENT_DATE + INTERVAL", () => {
  const s = translateSql("SELECT 1 WHERE date(created_at) >= date('now', '-30 days')");
  assert.ok(s.includes("CURRENT_DATE + INTERVAL '-30 days'"), s);
});

test("translateSql: julianday + strftime have PG translations", () => {
  const s = translateSql(
    "SELECT CAST((julianday('now') - julianday(created_at)) AS INTEGER) AS age_days, strftime('%Y-%m', received_at) AS month FROM t"
  );
  assert.ok(s.includes("EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)/86400.0"), s);
  assert.ok(s.includes("EXTRACT(EPOCH FROM CAST(created_at AS TIMESTAMP))/86400.0"), s);
  assert.ok(s.includes("TO_CHAR(CAST(received_at AS TIMESTAMP), 'YYYY-MM')"), s);
  assert.ok(!s.includes("julianday"), s);
});

test("translateSql: '?' positional params become $1..$n outside quotes", () => {
  const s = translateSql("INSERT INTO t (a, b, note) VALUES (?, ?, 'a ? literal')");
  assert.ok(s.includes("$1") && s.includes("$2"));
  assert.ok(s.includes("'a ? literal'"));
});
