import { createApp } from "./app.js";

const app = await createApp();
const PORT = Number(process.env.NEXUS_PORT || 8787);
app.listen(PORT, () => {
  console.log(`[NEXUS API] listening on http://127.0.0.1:${PORT} — DEMO ENVIRONMENT`);
});
