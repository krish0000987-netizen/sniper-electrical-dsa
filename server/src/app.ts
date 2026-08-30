import express from "express";
import cors from "cors";
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
  await createSchema();
  ensureDemoUsers();
  seedIfEmpty();

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
export default process.env.VERCEL ? await createApp() : null;
