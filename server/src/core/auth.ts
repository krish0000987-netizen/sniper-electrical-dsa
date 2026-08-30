import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { q1 } from "../db/connection.js";

// Secret for stateless session tokens. The demo defaults to a fixed value so
// every serverless instance validates the same tokens; production must set a
// strong NEXUS_AUTH_SECRET (e.g. via Vercel env vars).
const AUTH_SECRET = process.env.NEXUS_AUTH_SECRET || "nexus-demo-auth-secret";

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(pw, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/**
 * Issue a stateless, HMAC-signed session token (payload.signature). Sessions
 * are NOT stored in the DB, so any serverless instance (each with its own
 * ephemeral SQLite copy) can validate tokens created by another instance.
 */
export function createSession(userId: number): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + 30 * 24 * 3600 * 1000 })
  ).toString("base64url");
  return `${payload}.${signPayload(payload)}`;
}

function signPayload(payload: string): string {
  return createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
}

export interface SessionUser {
  id: number;
  tenant_id: number;
  branch_id: number | null;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  customer_id: number | null;
}

export async function getUserFromToken(token: string | undefined) {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = signPayload(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let data: { uid: number; exp: number };
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof data.uid !== "number" || typeof data.exp !== "number" || data.exp < Date.now()) return null;
  return (
    await q1<SessionUser>(
      `SELECT id, tenant_id, branch_id, name, email, role, phone, customer_id
       FROM users WHERE id = ?`,
      [data.uid]
    ) ?? null
  );
}

export function destroySession(_token: string) {
  // Stateless tokens — nothing to revoke server-side.
}

/* ---------------- RBAC ---------------- */

export const ROLES: Record<string, string[]> = {
  super_admin: ["*"],
  tenant_admin: [
    "dashboard.view", "leads.*", "customers.*", "applications.*", "credit.*", "bre.*",
    "underwriting.*", "loans.*", "payments.*", "collections.*", "recovery.*",
    "sanctions.*", "kfs.*", "compliance.*", "audit.view", "reports.*", "ai.*",
    "admin.users", "admin.products", "admin.rules", "admin.integrations", "admin.tenants",
    "gn.*"
  ],
  branch_admin: [
    "dashboard.view", "leads.*", "customers.*", "applications.*", "credit.view", "credit.fetch",
    "bre.view", "underwriting.view", "loans.view", "payments.view", "payments.record",
    "collections.*", "sanctions.view", "kfs.view", "reports.view", "ai.view", "gn.view", "gn.applications.edit"
  ],
  sales_manager: ["dashboard.view", "leads.*", "customers.view", "customers.edit", "applications.view", "applications.create", "reports.view", "ai.view", "gn.view", "gn.applications.edit"],
  telecaller: ["dashboard.view", "leads.view", "leads.edit", "leads.convert", "customers.view"],
  field_executive: ["dashboard.view", "leads.view", "leads.edit", "customers.view", "applications.view", "applications.create", "collections.view"],
  credit_analyst: ["dashboard.view", "applications.view", "applications.edit", "applications.advance", "credit.*", "bre.view", "bre.simulate", "underwriting.*", "kfs.view", "ai.view"],
  credit_manager: ["dashboard.view", "applications.*", "credit.*", "bre.view", "underwriting.*", "sanctions.*", "kfs.*", "approvals.decide", "loans.edit", "payments.reverse", "recovery.approve", "reports.view", "ai.view", "gn.view", "gn.applications.edit"],
  underwriter: ["dashboard.view", "applications.view", "credit.*", "bre.view", "bre.simulate", "underwriting.*", "kfs.view", "ai.view"],
  operations: ["dashboard.view", "applications.view", "applications.edit", "applications.advance", "documents.*", "sanctions.view", "kfs.view", "agreements.*", "loans.view", "disbursements.*", "payments.view", "payments.record", "gn.view", "gn.applications.edit"],
  collection_manager: ["dashboard.view", "loans.view", "collections.*", "recovery.*", "payments.view", "payments.record", "reports.view", "ai.view"],
  collection_agent: ["dashboard.view", "collections.view", "collections.edit", "payments.record", "customers.view", "loans.view"],
  dsa: ["dashboard.view", "leads.view", "leads.create", "leads.edit", "applications.view", "applications.create", "gn.view", "gn.applications.edit"],
  finance: ["dashboard.view", "loans.view", "loans.edit", "payments.*", "disbursements.view", "reports.view", "audit.view", "gn.*"],
  auditor: ["dashboard.view", "audit.view", "loans.view", "customers.view", "compliance.view", "reports.view", "payments.view"],
  compliance_officer: ["dashboard.view", "customers.view", "compliance.*", "audit.view", "kyc.*", "consents.*", "complaints.*", "applications.view", "kfs.view", "reports.view"],
  customer_support: ["dashboard.view", "customers.view", "complaints.*", "leads.view", "loans.view", "payments.view"],
  customer: ["portal.*", "dashboard.view"]
};

export function hasPermission(user: SessionUser, perm: string): boolean {
  const perms = ROLES[user.role] ?? [];
  for (const p of perms) {
    if (p === "*") return true;
    if (p.endsWith(".*") && perm.startsWith(p.slice(0, -1))) return true;
    if (p === perm) return true;
  }
  return false;
}

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  tenant_admin: "Tenant Admin",
  branch_admin: "Branch Admin",
  sales_manager: "Sales Manager",
  telecaller: "Telecaller",
  field_executive: "Field Executive",
  credit_analyst: "Credit Analyst",
  credit_manager: "Credit Manager",
  underwriter: "Underwriter",
  operations: "Operations",
  collection_manager: "Collection Manager",
  collection_agent: "Collection Agent",
  dsa: "DSA Partner",
  finance: "Finance",
  auditor: "Auditor",
  compliance_officer: "Compliance Officer",
  customer_support: "Customer Support",
  customer: "Customer"
};
