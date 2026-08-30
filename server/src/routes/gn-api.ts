import { Router } from "express";
import { z } from "zod";
import { q, q1, run } from "../db/connection.js";
import { audit } from "../core/audit.js";
import { asyncH, authRequired, clientIp, requirePerm, type AuthedRequest } from "../middleware.js";
import { applyLenderWebhook, WEBHOOK_EVENTS } from "../core/gn-co.js";

export const gnApiRouter = Router();
gnApiRouter.use(authRequired);

const T = (req: AuthedRequest) => req.user!.tenant_id;

export const API_CATEGORIES: { category: string; label: string; defaultStatus: string }[] = [
  { category: "otp", label: "OTP / SMS", defaultStatus: "demo_connected" },
  { category: "kyc", label: "KYC / e-KYC", defaultStatus: "demo_connected" },
  { category: "pan", label: "PAN Verification", defaultStatus: "demo_connected" },
  { category: "credit", label: "Credit Bureau", defaultStatus: "demo_connected" },
  { category: "gst", label: "GST", defaultStatus: "sandbox_ready" },
  { category: "udyam", label: "Udyam", defaultStatus: "sandbox_ready" },
  { category: "bank", label: "Bank Statement / Account Verification", defaultStatus: "sandbox_ready" },
  { category: "esign", label: "eSign", defaultStatus: "sandbox_ready" },
  { category: "lender", label: "Lender APIs", defaultStatus: "sandbox_ready" },
  { category: "disbursement", label: "Disbursement", defaultStatus: "not_connected" },
  { category: "document", label: "Document Verification", defaultStatus: "sandbox_ready" },
  { category: "email", label: "Email / WhatsApp", defaultStatus: "not_connected" }
];

gnApiRouter.get("/gn/api/providers", requirePerm("gn.api.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const rows = await q<Record<string, any>>("SELECT * FROM gn_api_providers WHERE tenant_id = ? ORDER BY id", [t]);
  // Ensure every category has at least one provider row (seed defaults)
  for (const c of API_CATEGORIES) {
    if (!rows.some((r) => r.category === c.category)) {
      const id = (await run(
        "INSERT INTO gn_api_providers (tenant_id, category, name, status, env, endpoint) VALUES (?, ?, ?, ?, 'demo', ?)",
        [t, c.category, `Demo ${c.label} Provider`, c.defaultStatus, `https://api.demo-provider.in/${c.category}`]
      )).lastId;
      rows.push(await q1("SELECT * FROM gn_api_providers WHERE id = ?", [id])!);
    }
  }
  res.json(rows);
}));

const providerSchema = z.object({
  name: z.string().optional(), status: z.string().optional(), env: z.string().optional(),
  endpoint: z.string().optional(), config: z.record(z.string(), z.any()).optional(), enabled: z.boolean().optional()
});

gnApiRouter.patch("/gn/api/providers/:id", requirePerm("gn.api.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = providerSchema.parse(req.body);
  const t = T(req);
  const before = await q1<Record<string, any>>("SELECT * FROM gn_api_providers WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!before) { res.status(404).json({ error: "Provider not found" }); return; }
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of ["name", "status", "env", "endpoint"] as const) {
    if (b[k] !== undefined) { sets.push(`${k} = ?`); params.push(b[k]); }
  }
  if (b.config !== undefined) { sets.push("config = ?"); params.push(JSON.stringify(b.config)); }
  if (b.enabled !== undefined) { sets.push("enabled = ?"); params.push(b.enabled ? 1 : 0); }
  if (sets.length) {
    params.push(before.id);
    await run(`UPDATE gn_api_providers SET ${sets.join(", ")} WHERE id = ?`, params);
  }
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.api.provider.update", entityType: "gn_api_provider", entityId: before.id, before: { status: before.status, env: before.env }, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_api_providers WHERE id = ?", [before.id]));
}));

gnApiRouter.post("/gn/api/providers/:id/test", requirePerm("gn.api.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const p = await q1<Record<string, any>>("SELECT * FROM gn_api_providers WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!p) { res.status(404).json({ error: "Provider not found" }); return; }
  const started = Date.now();
  const latency = Math.round(40 + Math.random() * 260);
  const ok = p.status === "not_connected" ? false : true;
  const response = ok
    ? { ok: true, reference: `${p.category.toUpperCase()}-DEMO-${String(100000 + Math.floor(Math.random() * 900000))}`, message: `${p.category} verification succeeded (demo)` }
    : { ok: false, error: "No credentials configured — connect a sandbox provider first" };
  await run(
    "INSERT INTO gn_api_logs (tenant_id, provider, category, action, endpoint, status, request_id, latency_ms, response, error, environment) VALUES (?, ?, ?, 'test_connection', ?, ?, ?, ?, ?, ?, ?)",
    [t, p.name, p.category, p.endpoint ?? null, ok ? "success" : "failed", `REQ-${Date.now()}`, latency, JSON.stringify(response), ok ? null : response.error, p.env]
  );
  await run("UPDATE gn_api_providers SET last_tested_at = datetime('now') WHERE id = ?", [p.id]);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.api.provider.test", entityType: "gn_api_provider", entityId: p.id, after: { ok, latency }, ip: clientIp(req) });
  res.json({ ok, latency_ms: latency, response });
}));

gnApiRouter.get("/gn/api/logs", requirePerm("gn.api.view"), asyncH(async (req: AuthedRequest, res) => {
  const { status = "", page = 1, limit = 30 } = req.query as Record<string, string>;
  const where = ["tenant_id = ?", status ? "status = ?" : "1 = 1"];
  const params: unknown[] = [T(req), ...(status ? [status] : [])];
  const total = (await q1<{ n: number }>(`SELECT COUNT(*) AS n FROM gn_api_logs WHERE ${where.join(" AND ")}`, params))!.n;
  const off = (Math.max(1, Number(page)) - 1) * Number(limit);
  const rows = await q<Record<string, any>>(`SELECT * FROM gn_api_logs WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, Number(limit), off]);
  const counts = await q1<Record<string, any>>(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status = 'retrying' THEN 1 ELSE 0 END) AS retrying
     FROM gn_api_logs WHERE tenant_id = ?`, [T(req)])!;
  res.json({ rows, total, page: Number(page), limit: Number(limit), counts });
}));

gnApiRouter.get("/gn/api/webhooks", requirePerm("gn.api.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q<Record<string, any>>(
    `SELECT w.*, a.ref AS app_ref, a.name AS app_name FROM gn_webhook_events w
     LEFT JOIN gn_applications a ON a.id = w.app_id
     WHERE w.tenant_id = ? ORDER BY w.id DESC LIMIT 100`, [T(req)]);
  res.json({ rows, events: Object.keys(WEBHOOK_EVENTS) });
}));

gnApiRouter.post("/gn/api/webhooks", requirePerm("gn.api.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ event: z.string(), app_ref: z.string(), amount: z.number().optional(), utr: z.string().optional() }).parse(req.body);
  const t = T(req);
  if (!WEBHOOK_EVENTS[b.event]) { res.status(400).json({ error: `Unknown event ${b.event}` }); return; }
  const app = await q1<Record<string, any>>("SELECT * FROM gn_applications WHERE ref = ? AND tenant_id = ?", [b.app_ref, t]);
  if (!app) { res.status(404).json({ error: `Application ${b.app_ref} not found` }); return; }
  const evtId = (await run(
    "INSERT INTO gn_webhook_events (tenant_id, provider, event, app_id, request_id, payload, status) VALUES (?, 'API Control Center', ?, ?, ?, ?, 'received')",
    [t, b.event, app.id, `WH-${Date.now()}`, JSON.stringify(b)]
  )).lastId;
  const out = await applyLenderWebhook(t, app.id, b.event, b.amount, b.utr);
  if (!out.ok) {
    await run("UPDATE gn_webhook_events SET status = 'failed', error = ? WHERE id = ?", [out.error, evtId]);
    res.status(400).json({ error: out.error });
    return;
  }
  const status = out.duplicate ? "received" : "processed";
  await run("UPDATE gn_webhook_events SET status = ?, processed_at = datetime('now') WHERE id = ?", [status, evtId]);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.api.webhook.simulate", entityType: "gn_webhook_event", entityId: evtId, after: { event: b.event, app_ref: b.app_ref, duplicate: !!out.duplicate }, ip: clientIp(req) });
  res.json({ ok: true, status: out.status, duplicate: !!out.duplicate });
}));

gnApiRouter.post("/gn/api/webhooks/:id/retry", requirePerm("gn.api.manage"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const evt = await q1<Record<string, any>>("SELECT * FROM gn_webhook_events WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!evt) { res.status(404).json({ error: "Webhook event not found" }); return; }
  if (evt.status === "processed") { res.status(400).json({ error: "Event already processed" }); return; }
  const payload = safeJson(evt.payload, {});
  await run("UPDATE gn_webhook_events SET status = 'retrying' WHERE id = ?", [evt.id]);
  const out = await applyLenderWebhook(t, evt.app_id ?? 0, evt.event, payload.amount, payload.utr);
  await run("UPDATE gn_webhook_events SET status = ?, error = ?, processed_at = datetime('now') WHERE id = ?", [out.ok ? "processed" : "failed", out.error ?? null, evt.id]);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.api.webhook.retry", entityType: "gn_webhook_event", entityId: evt.id, after: out, ip: clientIp(req) });
  res.json({ ok: out.ok, status: out.status ?? null, error: out.error ?? null });
}));

function safeJson(v: string, dflt: any): any {
  try { return JSON.parse(v); } catch { return dflt; }
}
