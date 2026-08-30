import { Router } from "express";
import { z } from "zod";
import { q1, run } from "../db/connection.js";
import { createSession, destroySession, getUserFromToken, hashPassword, verifyPassword } from "../core/auth.js";
import { audit } from "../core/audit.js";
import { asyncH, authRequired, clientIp, type AuthedRequest } from "../middleware.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4)
});

authRouter.post("/login", asyncH(async (req, res) => {
  const body = loginSchema.parse(req.body);
  const user = await q1<Record<string, any>>("SELECT * FROM users WHERE email = ?", [body.email.toLowerCase().trim()]);
  if (!user || !verifyPassword(body.password, user.password_hash)) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  if (!user.active) {
    res.status(403).json({ error: "Account disabled" });
    return;
  }
  const token = createSession(user.id);
  await run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", [user.id]);
  await audit({ tenantId: user.tenant_id, userId: user.id, action: "auth.login", ip: clientIp(req) });
  res.json({
    token,
    user: {
      id: user.id, tenant_id: user.tenant_id, branch_id: user.branch_id,
      name: user.name, email: user.email, role: user.role, phone: user.phone, customer_id: user.customer_id
    }
  });
}));

authRouter.post("/logout", authRequired, asyncH(async (req: AuthedRequest, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  destroySession(token);
  await audit({ tenantId: req.user!.tenant_id, userId: req.user!.id, action: "auth.logout", ip: clientIp(req) });
  res.json({ ok: true });
}));

authRouter.get("/me", authRequired, asyncH(async (req: AuthedRequest, res) => {
  res.json({ user: req.user });
}));

authRouter.post("/users", asyncH(async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(4),
    role: z.string(),
    branch_id: z.number().nullable().optional(),
    phone: z.string().optional()
  }).parse(req.body);
  const tenantId = 1;
  const id = (await run(
    "INSERT INTO users (tenant_id, branch_id, name, email, password_hash, role, phone) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [tenantId, body.branch_id ?? null, body.name, body.email.toLowerCase(), hashPassword(body.password), body.role, body.phone ?? null]
  )).lastId;
  res.json({ id });
}));

// Bootstrap: seed demo user accounts (idempotent)
export async function ensureDemoUsers() {
  const demos = [
    { email: "admin@nexus.demo", name: "Aarav Mehta", role: "super_admin", branch: null },
    { email: "credit@nexus.demo", name: "Priya Nair", role: "credit_manager", branch: 2 },
    { email: "underwriting@nexus.demo", name: "Rohan Kapoor", role: "underwriter", branch: 2 },
    { email: "collections@nexus.demo", name: "Kavita Rao", role: "collection_manager", branch: 3 },
    { email: "dsa@nexus.demo", name: "Vikram DSA", role: "dsa", branch: null },
    { email: "sales@nexus.demo", name: "Sneha Iyer", role: "sales_manager", branch: 1 },
    { email: "telecaller@nexus.demo", name: "Anita Desai", role: "telecaller", branch: 1 },
    { email: "ops@nexus.demo", name: "Mohit Sharma", role: "operations", branch: 1 },
    { email: "compliance@nexus.demo", name: "Nidhi Gupta", role: "compliance_officer", branch: null },
    { email: "auditor@nexus.demo", name: "Arjun Singh", role: "auditor", branch: null },
    { email: "customer@nexus.demo", name: "Rahul Customer", role: "customer", branch: null },
    { email: "field@nexus.demo", name: "Sanjay Field", role: "field_executive", branch: 1 },
    { email: "agent@nexus.demo", name: "Meena Agent", role: "collection_agent", branch: 3 },
    { email: "finance@nexus.demo", name: "Ritu Finance", role: "finance", branch: 1 }
  ];
  for (const d of demos) {
    const existing = await q1("SELECT id FROM users WHERE email = ?", [d.email]);
    if (existing) continue;
    await run(
      "INSERT INTO users (tenant_id, branch_id, name, email, password_hash, role) VALUES (1, ?, ?, ?, ?, ?)",
      [d.branch, d.name, d.email, hashPassword("demo1234"), d.role]
    );
  }
  // Link the portal customer account to its customer profile if it exists
  const portalUser = await q1<Record<string, any>>("SELECT id, customer_id FROM users WHERE email = 'customer@nexus.demo'");
  if (portalUser && !portalUser.customer_id) {
    const portalCust = await q1<{ id: number }>("SELECT id FROM customers WHERE customer_no = 'CUS10000'");
    if (portalCust) await run("UPDATE users SET customer_id = ? WHERE id = ?", [portalCust.id, portalUser.id]);
  }
}

export { getUserFromToken };
