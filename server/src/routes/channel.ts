import { Router } from "express";
import { z } from "zod";
import { q, q1, run } from "../db/connection.js";
import { audit } from "../core/audit.js";
import type { NextFunction } from "express";
import { asyncH, authRequired, clientIp, requirePerm, type AuthedRequest } from "../middleware.js";

/**
 * Channel portals (DSA / field sales / telecaller). Every query is scoped to
 * the logged-in user's own records — a DSA can never see another DSA's leads,
 * and field executives only see what they own.
 */
export const channelRouter = Router();
channelRouter.use(authRequired);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const CHANNEL_ROLES = new Set(["dsa", "field_executive", "telecaller", "sales_manager"]);

/** Per-route role guard (never router-level — use() would leak into later mounts). */
function requireChannelRole(req: AuthedRequest, res: any): boolean {
  if (!CHANNEL_ROLES.has(req.user!.role)) {
    res.status(403).json({ error: "Channel portal unavailable for this role" });
    return false;
  }
  return true;
}

/* ---------- DSA dashboard ---------- */

channelRouter.get("/channel/dsa", requirePerm("leads.view"), asyncH(async (req: AuthedRequest, res) => {
  if (!requireChannelRole(req, res)) return;
  const u = req.user!;
  const ownWhere = "dsa_id = ? OR owner_id = ?";
  const base: unknown[] = [u.tenant_id, u.id, u.id];
  const leads = await q<Record<string, any>>(`SELECT * FROM leads WHERE tenant_id = ? AND (${ownWhere}) ORDER BY id DESC LIMIT 100`, base);
  const appRows = await q<Record<string, any>>(
    `SELECT a.*, p.name AS product_name FROM applications a JOIN products p ON p.id = a.product_id
     WHERE a.tenant_id = ? AND (a.dsa_id = ? OR a.sales_officer_id = ?) ORDER BY a.id DESC LIMIT 100`,
    [u.tenant_id, u.id, u.id]);
  const disbursedApps = appRows.filter((a) => a.status === "approved" || a.stage === "disbursement");
  const approvedApps = appRows.filter((a) => a.decision === "approve");
  const totalDisbursed = disbursedApps.reduce((s, a) => s + (a.approved_amount ?? a.requested_amount ?? 0), 0);
  // Commission estimate — configurable 0.5% of sanctioned principal for demo
  const commission = Math.round(totalDisbursed * 0.005);
  const pendingPayout = Math.round(commission * 0.3);
  const byStatus = leads.reduce<Record<string, number>>((m, l) => { m[l.status] = (m[l.status] ?? 0) + 1; return m; }, {});
  res.json({
    role: "dsa",
    stats: {
      leads: leads.length,
      converted: leads.filter((l) => l.status === "converted").length,
      applications: appRows.length,
      approved: approvedApps.length,
      disbursed: disbursedApps.length,
      disbursed_amount: totalDisbursed,
      commission,
      pending_payout: pendingPayout
    },
    leads: leads.map((l) => ({ id: l.id, lead_no: l.lead_no, name: l.name, mobile: l.mobile, amount: l.requested_amount, status: l.status, created_at: l.created_at })),
    applications: appRows.map((a) => ({ id: a.id, application_no: a.application_no, product: a.product_name, amount: a.requested_amount, status: a.status, stage: a.stage, decision: a.decision })),
    funnel: { by_status: byStatus }
  });
}));

/* ---------- Field sales dashboard ---------- */

channelRouter.get("/channel/field", requirePerm("leads.view"), asyncH(async (req: AuthedRequest, res) => {
  if (!requireChannelRole(req, res)) return;
  const u = req.user!;
  const leads = await q<Record<string, any>>(
    `SELECT l.*, b.name AS branch_name FROM leads l LEFT JOIN branches b ON b.id = l.branch_id
     WHERE l.tenant_id = ? AND (l.owner_id = ? OR l.dsa_id = ?) ORDER BY l.id DESC LIMIT 200`,
    [u.tenant_id, u.id, u.id]);
  const todayLeads = leads.filter((l) => l.created_at?.slice(0, 10) === today());
  const activities = await q<Record<string, any>>(
    `SELECT la.*, l.lead_no, l.name AS lead_name FROM lead_activities la JOIN leads l ON l.id = la.lead_id
     WHERE la.user_id = ? ORDER BY la.id DESC LIMIT 100`, [u.id]);
  const visits = activities.filter((a) => a.kind === "visit");
  const calls = activities.filter((a) => a.kind === "call");
  const followups = leads.filter((l) => l.followup_at && l.followup_at <= today());
  const apps = await q<Record<string, any>>(
    `SELECT a.application_no, a.status, a.stage, a.decision, a.created_at FROM applications a
     WHERE a.tenant_id = ? AND a.sales_officer_id = ? ORDER BY a.id DESC LIMIT 50`, [u.tenant_id, u.id]);
  const target = 5; // daily lead target — configurable in admin later
  res.json({
    role: "field_executive",
    stats: {
      today_leads: todayLeads.length,
      total_leads: leads.length,
      followups_due: followups.length,
      visits: visits.length,
      calls: calls.length,
      applications: apps.length,
      conversions: leads.filter((l) => l.status === "converted").length,
      target,
      achieved_pct: Math.round((todayLeads.length / target) * 100)
    },
    today_leads: todayLeads.map((l) => ({ id: l.id, lead_no: l.lead_no, name: l.name, mobile: l.mobile, city: l.city, status: l.status, source: l.source })),
    activities: activities.slice(0, 30).map((a) => ({ id: a.id, lead_no: a.lead_no, lead_name: a.lead_name, kind: a.kind, outcome: a.outcome, note: a.note, created_at: a.created_at })),
    followups: followups.map((l) => ({ id: l.id, lead_no: l.lead_no, name: l.name, followup_at: l.followup_at, status: l.status })),
    applications: apps
  });
}));

/* ---------- Shared: my leads (create/edit scoped) ---------- */

channelRouter.get("/channel/my-leads", requirePerm("leads.view"), asyncH(async (req: AuthedRequest, res) => {
  if (!requireChannelRole(req, res)) return;
  const u = req.user!;
  const rows = await q<Record<string, any>>(
    `SELECT l.*, b.name AS branch_name FROM leads l LEFT JOIN branches b ON b.id = l.branch_id
     WHERE l.tenant_id = ? AND (l.owner_id = ? OR l.dsa_id = ?) ORDER BY l.id DESC LIMIT 100`,
    [u.tenant_id, u.id, u.id]);
  res.json({ rows });
}));

channelRouter.post("/channel/leads", requirePerm("leads.create"), asyncH(async (req: AuthedRequest, res) => {
  if (!requireChannelRole(req, res)) return;
  const body = z.object({
    name: z.string().min(2), mobile: z.string().min(10), email: z.string().optional(), city: z.string().optional(),
    loan_type: z.string().optional(), requested_amount: z.number().int().optional(), source: z.string().optional(),
    notes: z.string().optional()
  }).parse(req.body);
  const u = req.user!;
  const leadNo = "LD" + String(1000 + Math.floor(Math.random() * 8999)) + String(Math.floor(1000 + Math.random() * 8999));
  const id = (await run(
    `INSERT INTO leads (tenant_id, branch_id, lead_no, name, mobile, email, city, loan_type, requested_amount, source,
       dsa_id, owner_id, status, score, probability, next_action, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 0, 0, 'Assign & follow up', datetime('now'))`,
    [u.tenant_id, u.branch_id, leadNo, body.name, body.mobile, body.email ?? null, body.city ?? null,
     body.loan_type ?? "personal", body.requested_amount ?? null, body.source ?? "channel",
     u.role === "dsa" ? u.id : null, u.role === "dsa" ? null : u.id]
  )).lastId;
  await audit({ tenantId: u.tenant_id, userId: u.id, action: "channel.lead_create", entityType: "lead", entityId: id, after: body, ip: clientIp(req) });
  res.json({ id, lead_no: leadNo });
}));

/* ---------- Telecaller queue (role-scoped) ---------- */

channelRouter.get("/channel/telecall", requirePerm("leads.view"), asyncH(async (req: AuthedRequest, res) => {
  if (!requireChannelRole(req, res)) return;
  const u = req.user!;
  const rows = await q<Record<string, any>>(
    `SELECT l.id, l.lead_no, l.name, l.mobile, l.city, l.loan_type, l.requested_amount, l.status, l.followup_at, l.score
     FROM leads l WHERE l.tenant_id = ? AND (l.owner_id = ? OR l.status IN ('new','assigned'))
     ORDER BY CASE l.status WHEN 'new' THEN 0 WHEN 'assigned' THEN 1 ELSE 2 END, l.followup_at NULLS LAST LIMIT 50`,
    [u.tenant_id, u.id]);
  const doneToday = await q1<{ n: number }>(
    `SELECT COUNT(*) AS n FROM lead_activities WHERE user_id = ? AND date(created_at) = date('now')`, [u.id]);
  res.json({ rows, done_today: doneToday?.n ?? 0 });
}));
