import { Router } from "express";
import { q, q1, run } from "../db/connection.js";
import { asyncH, authRequired, requirePerm, type AuthedRequest } from "../middleware.js";

export const analyticsRouter = Router();
analyticsRouter.use(authRequired);

/* ---------- EXECUTIVE DASHBOARD ---------- */

analyticsRouter.get("/dashboard", requirePerm("dashboard.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = req.user!.tenant_id;
  const portfolio = await q1<Record<string, any>>(`SELECT COALESCE(SUM(outstanding), 0) AS v, COUNT(*) AS n FROM loans WHERE tenant_id = ? AND status NOT IN ('closed','written_off')`, [t]);
  const disbursed = await q1<Record<string, any>>(`SELECT COALESCE(SUM(principal), 0) AS v FROM loans WHERE tenant_id = ? AND date(disbursed_at) >= date('now', '-30 days')`, [t]);
  const applications = await q1<Record<string, any>>(`SELECT COUNT(*) AS n FROM applications WHERE tenant_id = ?`, [t]);
  const approved = await q1<Record<string, any>>(`SELECT COUNT(*) AS n FROM applications WHERE tenant_id = ? AND decision = 'approve'`, [t]);
  const rejected = await q1<Record<string, any>>(`SELECT COUNT(*) AS n FROM applications WHERE tenant_id = ? AND decision = 'reject'`, [t]);
  const overdue = await q1<Record<string, any>>(`SELECT COALESCE(SUM(outstanding), 0) AS v FROM loans WHERE tenant_id = ? AND status = 'overdue'`, [t]);
  const npa = await q1<Record<string, any>>(`SELECT COALESCE(SUM(outstanding), 0) AS v FROM loans WHERE tenant_id = ? AND npa_class IS NOT NULL`, [t]);
  const collected30 = await q1<Record<string, any>>(
    `SELECT COALESCE(SUM(p.amount), 0) AS v FROM payments p WHERE p.tenant_id = ? AND p.reversed = 0 AND date(p.received_at) >= date('now', '-30 days')`, [t]);
  const due30 = await q1<Record<string, any>>(
    `SELECT COALESCE(SUM(i.total), 0) AS v FROM installments i JOIN loans l ON l.id = i.loan_id
     WHERE l.tenant_id = ? AND i.due_date BETWEEN date('now', '-30 days') AND date('now')`, [t]);
  const approvalRate = approved!.n + rejected!.n > 0 ? Math.round((approved!.n / (approved!.n + rejected!.n)) * 1000) / 10 : 0;
  const collectionEfficiency = due30!.v > 0 ? Math.round((collected30!.v / due30!.v) * 1000) / 10 : 0;
  const npaPct = portfolio!.v > 0 ? Math.round((npa!.v / portfolio!.v) * 1000) / 10 : 0;

  // Disbursement trend (last 6 months)
  const trend = await q<Record<string, any>>(
    `SELECT strftime('%Y-%m', disbursed_at) AS month, COALESCE(SUM(principal), 0) AS disbursed
     FROM loans WHERE tenant_id = ? AND disbursed_at >= date('now', '-6 months') GROUP BY month ORDER BY month`, [t]);
  const months: string[] = [];
  const labels: string[] = [];
  const today = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    labels.push(d.toLocaleString("en-IN", { month: "short" }));
    months.push(d.toISOString().slice(0, 7));
  }
  const disbursementTrend = months.map((m, i) => {
    const row = trend.find((r) => r.month === m);
    return { month: labels[i], value: row?.disbursed ?? 0 };
  });

  // Product mix
  const productMix = await q<Record<string, any>>(
    `SELECT p.name, COALESCE(SUM(l.outstanding), 0) AS value, COUNT(*) AS loans
     FROM loans l JOIN products p ON p.id = l.product_id WHERE l.tenant_id = ? AND l.status NOT IN ('closed','written_off')
     GROUP BY p.name ORDER BY value DESC`, [t]);

  // State distribution (demo data)
  const byState = await q<Record<string, any>>(
    `SELECT c.state, COALESCE(SUM(l.outstanding), 0) AS value, COUNT(*) AS loans
     FROM loans l JOIN customers c ON c.id = l.customer_id
     WHERE l.tenant_id = ? AND l.status NOT IN ('closed','written_off') GROUP BY c.state ORDER BY value DESC`, [t]);

  const pipeline = await q<Record<string, any>>(
    `SELECT stage, COUNT(*) AS n, COALESCE(SUM(requested_amount), 0) AS amount FROM applications
     WHERE tenant_id = ? AND status != 'rejected' GROUP BY stage ORDER BY MIN(id)`, [t]);
  const stageOrder = ["application", "kyc", "documents", "credit", "banking", "gst", "bre", "underwriting", "approval", "sanction", "kfs", "agreement", "esign", "disbursement"];
  const pipelineChart = stageOrder
    .map((s) => pipeline.find((p) => p.stage === s))
    .filter(Boolean)
    .map((p) => ({ stage: p!.stage.replace(/_/g, " "), count: p!.n, amount: p!.amount }));

  const recent = await q<Record<string, any>>(
    `SELECT al.action, al.entity_type, al.entity_id, al.created_at, u.name AS by_name
     FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id WHERE al.tenant_id = ? ORDER BY al.id DESC LIMIT 12`, [t]);
  const alerts = await q<Record<string, any>>(
    `SELECT title, body, created_at FROM notifications WHERE tenant_id = ? ORDER BY id DESC LIMIT 8`, [t]);

  const leadsToday = await q1<Record<string, any>>(`SELECT COUNT(*) AS n FROM leads WHERE tenant_id = ? AND date(created_at) = date('now')`, [t]);
  const stageDistribution = await q<Record<string, any>>(
    `SELECT stage, COUNT(*) AS n FROM applications WHERE tenant_id = ? GROUP BY stage`, [t]);

  res.json({
    kpis: {
      portfolio: portfolio!.v, activeLoans: portfolio!.n,
      disbursement30d: disbursed!.v, applications: applications!.n,
      approvalRate, collectionEfficiency, overdue: overdue!.v, npa: npa!.v, npaPct,
      leadsToday: leadsToday!.n, loansApproved: approved!.n
    },
    disbursementTrend,
    productMix,
    byState,
    pipeline: pipelineChart,
    recent,
    alerts,
    stageDistribution
  });
}));

/* ---------- REPORTS ---------- */

analyticsRouter.get("/reports", requirePerm("reports.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = req.user!.tenant_id;
  const loanPortfolio = await q<Record<string, any>>(
    `SELECT p.name AS product, COUNT(*) AS loans, COALESCE(SUM(l.principal), 0) AS principal, COALESCE(SUM(l.outstanding), 0) AS outstanding,
       COALESCE(AVG(l.rate), 0) AS avg_rate, COALESCE(SUM(CASE WHEN l.dpd > 0 THEN 1 ELSE 0 END), 0) AS overdue_count,
       COALESCE(SUM(l.dpd > 0), 0) AS overdue
     FROM loans l JOIN products p ON p.id = l.product_id WHERE l.tenant_id = ? AND l.status NOT IN ('closed','written_off')
     GROUP BY p.name ORDER BY outstanding DESC`, [t]);
  const approvalByProduct = await q<Record<string, any>>(
    `SELECT p.name AS product,
       COUNT(*) AS apps,
       SUM(CASE WHEN a.decision = 'approve' THEN 1 ELSE 0 END) AS approved,
       SUM(CASE WHEN a.decision = 'reject' THEN 1 ELSE 0 END) AS rejected,
       COALESCE(SUM(CASE WHEN a.stage IN ('bre','underwriting','approval') THEN 1 ELSE 0 END), 0) AS in_pipeline
     FROM applications a JOIN products p ON p.id = a.product_id WHERE a.tenant_id = ? GROUP BY p.name`, [t]);
  const dpdBook = await q<Record<string, any>>(
    `SELECT CASE WHEN l.dpd = 0 THEN '0' WHEN l.dpd = 1 THEN '1-30' WHEN l.dpd = 2 THEN '31-60' WHEN l.dpd = 3 THEN '61-90' ELSE '90+' END AS bucket,
       COUNT(*) AS loans, COALESCE(SUM(l.outstanding), 0) AS outstanding
     FROM loans l WHERE l.tenant_id = ? AND l.status NOT IN ('closed','written_off') GROUP BY bucket`, [t]);
  const branchPerformance = await q<Record<string, any>>(
    `SELECT b.name AS branch, b.city,
       COUNT(DISTINCT l.id) AS loans, COALESCE(SUM(l.outstanding), 0) AS outstanding,
       COUNT(DISTINCT a.id) AS applications,
       COUNT(DISTINCT CASE WHEN a.decision = 'approve' THEN a.id END) AS approved
     FROM branches b
     LEFT JOIN loans l ON l.branch_id = b.id AND l.status NOT IN ('closed','written_off')
     LEFT JOIN applications a ON a.branch_id = b.id
     WHERE b.tenant_id = ? GROUP BY b.id, b.name, b.city ORDER BY outstanding DESC`, [t]);
  const dsaPerformance = await q<Record<string, any>>(
    `SELECT u.name AS dsa,
       COUNT(DISTINCT l.id) AS leads,
       SUM(CASE WHEN l.status = 'converted' THEN 1 ELSE 0 END) AS converted,
       COUNT(DISTINCT a.id) AS applications,
       COUNT(DISTINCT CASE WHEN a.decision = 'approve' THEN a.id END) AS approved
     FROM users u
     LEFT JOIN leads l ON l.dsa_id = u.id
     LEFT JOIN applications a ON a.dsa_id = u.id
     WHERE u.tenant_id = ? AND u.role = 'dsa' GROUP BY u.id, u.name ORDER BY converted DESC`, [t]);
  const monthlyCollections = await q<Record<string, any>>(
    `SELECT strftime('%Y-%m', p.received_at) AS month, COUNT(*) AS payments, COALESCE(SUM(p.amount), 0) AS amount
     FROM payments p WHERE p.tenant_id = ? AND p.reversed = 0 AND p.received_at >= date('now', '-6 months')
     GROUP BY month ORDER BY month`, [t]);
  res.json({ loanPortfolio, approvalByProduct, dpdBook, branchPerformance, dsaPerformance, monthlyCollections });
}));

/* ---------- RISK ---------- */

analyticsRouter.get("/risk", requirePerm("reports.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = req.user!.tenant_id;
  const concentration = await q<Record<string, any>>(
    `SELECT c.state, COUNT(*) AS loans, COALESCE(SUM(l.outstanding), 0) AS outstanding, COALESCE(SUM(l.outstanding), 0) * 100.0 / NULLIF((SELECT SUM(outstanding) FROM loans WHERE tenant_id = ? AND status NOT IN ('closed','written_off')), 0) AS pct
     FROM loans l JOIN customers c ON c.id = l.customer_id
     WHERE l.tenant_id = ? AND l.status NOT IN ('closed','written_off') GROUP BY c.state ORDER BY outstanding DESC LIMIT 8`, [t, t]);
  const riskGrades = await q<Record<string, any>>(
    `SELECT COALESCE(risk_grade, 'unknown') AS grade, COUNT(*) AS n, COALESCE(SUM(outstanding), 0) AS outstanding
     FROM loans WHERE tenant_id = ? AND status NOT IN ('closed','written_off') GROUP BY grade`, [t]);
  const earlyWarnings = await q<Record<string, any>>(
    `SELECT l.loan_no, c.name AS customer, l.dpd, l.status, 'Increasing DPD' AS signal
     FROM loans l JOIN customers c ON c.id = l.customer_id
     WHERE l.tenant_id = ? AND l.dpd = 1 AND l.status = 'overdue' ORDER BY l.outstanding DESC LIMIT 10`, [t]);
  const highRiskLoans = await q<Record<string, any>>(
    `SELECT l.loan_no, c.name AS customer, l.outstanding, l.dpd, l.risk_grade
     FROM loans l JOIN customers c ON c.id = l.customer_id
     WHERE l.tenant_id = ? AND l.risk_grade IN ('medium','high') AND l.status = 'overdue' ORDER BY l.dpd DESC LIMIT 10`, [t]);
  const fraud = await q<Record<string, any>>(
    `SELECT a.application_no, c.name AS customer, a.fraud_score, a.status, a.created_at
     FROM applications a JOIN customers c ON c.id = a.customer_id
     WHERE a.tenant_id = ? AND a.fraud_score IS NOT NULL AND a.fraud_score > 15 ORDER BY a.fraud_score DESC LIMIT 10`, [t]);
  res.json({ concentration, riskGrades, earlyWarnings, highRiskLoans, fraud });
}));

/* ---------- NEXUS AI ---------- */

analyticsRouter.post("/ai/query", requirePerm("ai.view"), asyncH(async (req: AuthedRequest, res) => {
  const body = (req.body || {}) as { prompt?: string };
  const prompt = (body.prompt || "").toLowerCase();
  const t = req.user!.tenant_id;
  const user = req.user!;
  let result: Record<string, unknown> = { intent: "help" };

  if (prompt.includes("attention") || prompt.includes("priorit")) {
    const highRisk = await q1<Record<string, any>>("SELECT COUNT(*) AS n FROM applications WHERE tenant_id = ? AND stage IN ('bre','underwriting','approval') AND bre_result != 'eligible'", [t]);
    const slaBreach = await q1<Record<string, any>>("SELECT COUNT(*) AS n FROM applications WHERE tenant_id = ? AND status != 'rejected' AND julianday('now') - julianday(created_at) > 2", [t]);
    const overdue = await q1<Record<string, any>>("SELECT COUNT(*) AS n, COALESCE(SUM(outstanding), 0) AS v FROM loans WHERE tenant_id = ? AND status = 'overdue'", [t]);
    result = {
      intent: "attention",
      headline: `${(highRisk?.n ?? 0) + (slaBreach?.n ?? 0) + (overdue?.n ?? 0)} items need attention`,
      items: [
        { label: `${highRisk?.n ?? 0} applications require credit review`, severity: "high" },
        { label: `${slaBreach?.n ?? 0} applications breaching 48h SLA`, severity: "medium" },
        { label: `${overdue?.n ?? 0} overdue accounts totalling ${inrShort(overdue?.v ?? 0)}`, severity: "high" }
      ]
    };
  } else if (prompt.includes("overdue") && prompt.includes("top")) {
    const rows = await q<Record<string, any>>(
      `SELECT l.loan_no, c.name AS customer, l.outstanding, l.dpd FROM loans l JOIN customers c ON c.id = l.customer_id
       WHERE l.tenant_id = ? AND l.status = 'overdue' ORDER BY l.dpd DESC, l.outstanding DESC LIMIT 20`, [t]);
    result = { intent: "top_overdue", headline: `Top ${rows.length} overdue accounts`, rows };
  } else if (prompt.includes("overdue") || prompt.includes("missed payment")) {
    const rows = await q<Record<string, any>>(
      `SELECT l.loan_no, c.name AS customer, l.outstanding, l.dpd, l.npa_class FROM loans l JOIN customers c ON c.id = l.customer_id
       WHERE l.tenant_id = ? AND l.status = 'overdue' ORDER BY l.dpd DESC LIMIT 10`, [t]);
    result = { intent: "overdue", headline: `${rows.length} loans became overdue`, rows };
  } else if (prompt.includes("lead") && prompt.includes("convert")) {
    const rows = await q<Record<string, any>>(
      `SELECT l.name, l.status, l.score, l.probability, l.requested_amount, l.source FROM leads l
       WHERE l.tenant_id = ? AND l.status IN ('new','assigned','contacted','followup','interested') ORDER BY l.score DESC LIMIT 10`, [t]);
    result = { intent: "lead_score", headline: "Leads most likely to convert (by score)", rows };
  } else if (prompt.includes("dsa")) {
    const rows = await q<Record<string, any>>(
      `SELECT u.name, COUNT(l.id) AS leads, SUM(CASE WHEN l.status = 'converted' THEN 1 ELSE 0 END) AS converted,
         COUNT(DISTINCT CASE WHEN a.decision = 'approve' THEN a.id END) AS approved
       FROM users u LEFT JOIN leads l ON l.dsa_id = u.id LEFT JOIN applications a ON a.dsa_id = u.id
       WHERE u.tenant_id = ? AND u.role = 'dsa' GROUP BY u.id, u.name ORDER BY converted DESC LIMIT 10`, [t]);
    result = { intent: "dsa_performance", headline: "DSA performance ranking", rows };
  } else if (prompt.includes("branch") && (prompt.includes("collection") || prompt.includes("worsen"))) {
    const rows = await q<Record<string, any>>(
      `SELECT b.name, COUNT(l.id) AS loans, SUM(CASE WHEN l.dpd > 0 THEN 1 ELSE 0 END) AS overdue
       FROM branches b JOIN loans l ON l.branch_id = b.id WHERE b.tenant_id = ? AND l.status = 'overdue'
       GROUP BY b.id, b.name ORDER BY overdue DESC`, [t]);
    result = { intent: "branch_collections", headline: "Branches with collection stress", rows };
  } else if (prompt.includes("ptp") || prompt.includes("promise")) {
    const rows = await q<Record<string, any>>(
      `SELECT pt.loan_id, l.loan_no, c.name AS customer, pt.amount, pt.due_date, pt.status
       FROM ptps pt JOIN loans l ON l.id = pt.loan_id JOIN customers c ON c.id = pt.customer_id
       WHERE pt.status = 'promised' AND pt.due_date <= date('now', '+3 days') ORDER BY pt.due_date LIMIT 10`, [t]);
    result = { intent: "ptp", headline: `${rows.length} PTPs due in next 3 days — flag for follow-up`, rows };
  } else if (prompt.includes("portfolio") || prompt.includes("summary")) {
    const p = await q1<Record<string, any>>(`SELECT COALESCE(SUM(outstanding), 0) AS v, COUNT(*) AS n FROM loans WHERE tenant_id = ? AND status NOT IN ('closed','written_off')`, [t]);
    const npa = await q1<Record<string, any>>(`SELECT COALESCE(SUM(outstanding), 0) AS v FROM loans WHERE tenant_id = ? AND npa_class IS NOT NULL`, [t]);
    result = {
      intent: "portfolio",
      headline: `Portfolio: ${inrShort(p!.v)} across ${p!.n} active loans`,
      items: [
        { label: `NPA book ${inrShort(npa!.v)}`, severity: p!.v > 0 && npa!.v / p!.v > 0.03 ? "high" : "low" },
        { label: `${(await q1<{ n: number }>(`SELECT COUNT(*) AS n FROM applications WHERE tenant_id = ? AND status = 'approved'`, [t]))!.n} approved applications awaiting disbursement`, severity: "medium" }
      ]
    };
  } else if (prompt.includes("help") || prompt.includes("what can")) {
    result = {
      intent: "help",
      headline: "NEXUS AI Command Center",
      items: [
        { label: "“What needs my attention today?”", severity: "info" },
        { label: "“Top 20 overdue accounts”", severity: "info" },
        { label: "“Which leads are most likely to convert?”", severity: "info" },
        { label: "“Which DSA is performing best?”", severity: "info" },
        { label: "“Summarize the portfolio”", severity: "info" },
        { label: "“Which PTPs are due this week?”", severity: "info" }
      ]
    };
  }

  await run("INSERT INTO ai_recommendations (tenant_id, user_id, kind, prompt, result) VALUES (?, ?, 'query', ?, ?)",
    [t, user.id, body.prompt ?? "", JSON.stringify(result)]);
  res.json(result);
}));

analyticsRouter.get("/ai/history", requirePerm("ai.view"), asyncH(async (req: AuthedRequest, res) => {
  const rows = await q("SELECT * FROM ai_recommendations WHERE tenant_id = ? ORDER BY id DESC LIMIT 20", [req.user!.tenant_id]);
  res.json(rows);
}));

/* ---------- GLOBAL SEARCH ---------- */

analyticsRouter.get("/search", asyncH(async (req: AuthedRequest, res) => {
  const query = String(req.query.q || "").trim();
  if (query.length < 2) { res.json({ customers: [], leads: [], applications: [], loans: [] }); return; }
  const t = req.user!.tenant_id;
  const like = `%${query}%`;
  const customers = await q(`SELECT id, customer_no, name, mobile, city FROM customers WHERE tenant_id = ? AND (name LIKE ? OR mobile LIKE ? OR customer_no LIKE ?) LIMIT 5`, [t, like, like, like]);
  const leads = await q(`SELECT id, lead_no, name, mobile, status FROM leads WHERE tenant_id = ? AND (name LIKE ? OR mobile LIKE ? OR lead_no LIKE ?) LIMIT 5`, [t, like, like, like]);
  const applications = await q(`SELECT id, application_no, customer_id, status, stage FROM applications WHERE tenant_id = ? AND application_no LIKE ? LIMIT 5`, [t, like]);
  const loans = await q(`SELECT id, loan_no, customer_id, status FROM loans WHERE tenant_id = ? AND loan_no LIKE ? LIMIT 5`, [t, like]);
  res.json({ customers, leads, applications, loans });
}));

/* ---------- NOTIFICATIONS ---------- */

analyticsRouter.get("/notifications", asyncH(async (req: AuthedRequest, res) => {
  const rows = await q("SELECT * FROM notifications WHERE tenant_id = ? ORDER BY id DESC LIMIT 20", [req.user!.tenant_id]);
  const unread = await q1<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE tenant_id = ? AND read = 0", [req.user!.tenant_id]);
  res.json({ rows, unread: unread!.n });
}));

analyticsRouter.post("/notifications/read", asyncH(async (req: AuthedRequest, res) => {
  await run("UPDATE notifications SET read = 1 WHERE tenant_id = ?", [req.user!.tenant_id]);
  res.json({ ok: true });
}));

function inrShort(n: number): string {
  return "₹" + n.toLocaleString("en-IN");
}
