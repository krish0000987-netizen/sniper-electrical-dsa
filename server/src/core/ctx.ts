import { q1 } from "../db/connection.js";

/** Build the flat context used by BRE / underwriting for an application. */
export async function buildApplicationContext(applicationId: number) {
  const app = await q1<Record<string, any>>(
    `SELECT a.*, c.name AS customer_name, c.dob, c.employment_type, c.business_name,
            c.annual_income, c.monthly_income, c.business_turnover, c.credit_score,
            c.risk_class, c.pan, c.city, c.state,
            p.name AS product_name, p.max_amount AS product_max, p.max_tenure AS product_max_tenure,
            p.min_amount AS product_min, p.min_tenure AS product_min_tenure
     FROM applications a
     JOIN customers c ON c.id = a.customer_id
     JOIN products p ON p.id = a.product_id
     WHERE a.id = ?`,
    [applicationId]
  );
  if (!app) return {};

  const bureau = await q1<Record<string, any>>("SELECT * FROM bureau_reports WHERE customer_id = ? ORDER BY id DESC LIMIT 1", [app.customer_id]);
  const bank = await q1<Record<string, any>>("SELECT * FROM bank_analyses WHERE application_id = ? ORDER BY id DESC LIMIT 1", [applicationId]);
  const gst = await q1<Record<string, any>>("SELECT * FROM gst_profiles WHERE customer_id = ? ORDER BY id DESC LIMIT 1", [app.customer_id]);
  const docs = await q1<Record<string, any>>("SELECT COUNT(*) AS n FROM documents WHERE application_id = ? AND status = 'verified'", [applicationId]);
  const exposure = await q1<Record<string, any>>(
    `SELECT COALESCE(SUM(outstanding), 0) AS total FROM loans WHERE customer_id = ? AND status NOT IN ('closed', 'written_off')`,
    [app.customer_id]
  );
  const age = app.dob ? Math.floor((Date.now() - new Date(app.dob).getTime()) / (365.25 * 86400000)) : null;

  return {
    "application.id": app.id,
    "application.requested_amount": app.requested_amount,
    "application.tenure": app.tenure,
    "application.purpose": app.purpose,
    "application.stage": app.stage,
    "customer.name": app.customer_name,
    "customer.age": age,
    "customer.dob": app.dob,
    "customer.employment_type": app.employment_type,
    "customer.monthly_income": app.monthly_income,
    "customer.annual_income": app.annual_income,
    "customer.business_turnover": app.business_turnover,
    "customer.credit_score": app.credit_score ?? bureau?.score ?? null,
    "customer.risk_class": app.risk_class,
    "customer.city": app.city,
    "customer.state": app.state,
    "customer.pan": app.pan,
    "product.category": app.product_name,
    "product.max_amount": app.product_max,
    "product.max_tenure": app.product_max_tenure,
    "credit.score": bureau?.score ?? null,
    "credit.dpd_max": bureau?.dpd_max ?? 0,
    "credit.total_outstanding": bureau?.total_outstanding ?? 0,
    "credit.utilization": bureau?.credit_utilization ?? 0,
    "credit.enquiries_6m": bureau?.enquiries_6m ?? 0,
    "credit.writeoffs": bureau?.writeoffs ?? 0,
    "credit.settlements": bureau?.settlements ?? 0,
    "credit.overdue_accounts": bureau?.overdue_accounts ?? 0,
    "bank.monthly_income": bank?.monthly_income ?? null,
    "bank.monthly_expense": bank?.monthly_expense ?? null,
    "bank.avg_balance": bank?.avg_balance ?? null,
    "bank.emi_obligations": bank?.emi_obligations ?? 0,
    "bank.surplus": bank?.banking_surplus ?? null,
    "bank.bounce_count": bank?.bounce_count ?? 0,
    "bank.cash_deposits": bank?.cash_deposits ?? 0,
    "bank.turnover": bank?.turnover ?? 0,
    "gst.turnover": gst?.turnover ?? null,
    "gst.filing_status": gst?.filing_status ?? null,
    "gst.declared_vs_banking_pct": gst?.declared_vs_banking_pct ?? null,
    "documents.verified": docs?.n ?? 0,
    "exposure.total": exposure?.total ?? 0
  };
}

/** Financial capacity metrics used by underwriting & KFS. */
export function capacityMetrics(ctx: Record<string, unknown>) {
  const income = Number(ctx["bank.monthly_income"] ?? ctx["customer.monthly_income"] ?? 0);
  const obligations = Number(ctx["bank.emi_obligations"] ?? 0);
  const surplus = Number(ctx["bank.surplus"] ?? (income - obligations));
  const foir = income > 0 ? Math.round(((obligations / income) * 100) * 10) / 10 : null;
  const dscr = obligations > 0 ? Math.round((surplus / obligations) * 100) / 100 : null;
  return { income, obligations, surplus, foir, dscr };
}
