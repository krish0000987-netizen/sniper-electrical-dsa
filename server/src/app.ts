import express from "express";
import cors from "cors";
import { q1 } from "./db/connection.js";
import { createSchema } from "./db/schema.js";
import { ensureDemoUsers } from "./routes/auth.js";
import { seedIfEmpty } from "./db/seed.js";
import { authRouter } from "./routes/auth.js";
import { crmRouter } from "./routes/crm.js";
import { losRouter } from "./routes/los.js";
import { losExtrasRouter } from "./routes/los-extras.js";
import { lmsRouter } from "./routes/lms.js";
import { lmsExtrasRouter } from "./routes/lms-extras.js";
import { reconRouter } from "./routes/recon.js";
import { portalRouter } from "./routes/portal.js";
import { channelRouter } from "./routes/channel.js";
import { collectionsRouter } from "./routes/collections.js";
import { gnRouter } from "./routes/gn.js";
import { gnAdminRouter } from "./routes/gn-admin.js";
import { gnPipelineRouter, gnWebhookRouter } from "./routes/gn-pipeline.js";
import { gnFinanceRouter } from "./routes/gn-finance.js";
import { gnCoRouter } from "./routes/gn-co.js";
import { gnBulkRouter } from "./routes/gn-bulk.js";
import { gnApiRouter } from "./routes/gn-api.js";
import { analyticsRouter } from "./routes/analytics.js";
import { adminRouter } from "./routes/admin.js";
import { errorHandler } from "./middleware.js";

/** Build the NEXUS API app. Schema creation and demo seeding run on first build. */
export async function createApp() {
  // Serverless note: Vercel functions have a hard invocation budget (default
  // ~10 s on Hobby) and boot the module on EVERY cold start. The demo seed
  // takes 20–30 s, so it must never run inside a serverless invocation — seed
  // the hosted database out-of-band once (`npm run seed -w server`) and let
  // cold starts skip it. Local dev and tests keep auto-seeding.
  const onVercel = process.env.VERCEL === "1";
  const autoSeed = !onVercel || process.env.DATABASE_AUTO_SEED === "true";
  if (process.env.DATABASE_SKIP_SCHEMA !== "true") await createSchema();
  if (autoSeed) await seedIfEmpty();

  // Demo users reference tenant 1 and the seeded customer profile. Only upsert
  // them when a demo dataset actually exists — on an empty serverless DB this
  // would otherwise throw a foreign-key violation during module boot.
  const customers = await q1<{ n: number }>("SELECT COUNT(*) AS n FROM customers");
  if ((customers?.n ?? 0) > 0) await ensureDemoUsers();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  app.get("/", (_req, res) => res.json({ status: "ok", service: "nexus-api", environment: "DEMO", docs: "/api/health", version: "1.0" }));
  app.get("/health", (_req, res) => res.json({ status: "ok", service: "nexus-api", environment: "DEMO" }));
  app.get("/api", (_req, res) => res.json({ status: "ok", service: "nexus-api", environment: "DEMO", docs: "/api/health" }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "nexus-api", environment: "DEMO" }));

  app.use("/api/auth", authRouter);
  // Public lender webhooks — must mount before the auth-guarded routers (router-level guards
  // apply to every /api request that passes through them).
  app.use("/api", gnWebhookRouter);
  app.use("/api", analyticsRouter);
  app.use("/api", crmRouter);
  app.use("/api", losExtrasRouter);
  app.use("/api", losRouter);
  app.use("/api", lmsRouter);
  app.use("/api", lmsExtrasRouter);
  app.use("/api", reconRouter);
  app.use("/api", portalRouter);
  app.use("/api", channelRouter);
  app.use("/api", collectionsRouter);
  app.use("/api", gnRouter);
  app.use("/api", gnAdminRouter);
  app.use("/api", gnPipelineRouter);
  app.use("/api", gnFinanceRouter);
  app.use("/api", gnCoRouter);
  app.use("/api", gnBulkRouter);
  app.use("/api", gnApiRouter);
  app.use("/api/admin", adminRouter);

  app.use(errorHandler);
  return app;
}

// Vercel's Express preset imports `src/app.ts` directly and requires the
// module's default export to be the Express app (it never runs `src/index.ts`).
// Locally and in tests only the named `await createApp()` is used, so keep the default
// export null outside Vercel to avoid an extra boot-time schema/seed pass.
//
// A failed boot must not kill the module (that surfaces as a bare 500
// FUNCTION_INVOCATION_FAILED with no diagnostics). Degrade to a minimal app
// that answers /health and explains the provisioning state instead.
async function bootForVercel() {
  try {
    return await createApp();
  } catch (err) {
    console.error("[NEXUS] serverless boot failed — check DATABASE_URL/DATABASE_SSL and that the hosted DB is provisioned:", err);
    const degraded = express();
    degraded.use((_req, res) =>
      res.status(503).json({
        error: "API database not provisioned",
        detail: "Set DATABASE_URL (and DATABASE_SSL=true for hosted PG), seed once with `npm run seed -w server`, then redeploy. See docs/digitap-integration.md § Deployment."
      })
    );
    return degraded;
  }
}

export default process.env.VERCEL ? await bootForVercel() : null;
