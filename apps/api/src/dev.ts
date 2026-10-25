// Servidor local de la API sin Next: `pnpm --filter @fianzas/api dev` → http://localhost:8787/api/health
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadConfigFromEnv } from "./config";

const cfg = loadConfigFromEnv();
const app = createApp(cfg);
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`@fianzas/api en http://localhost:${port}/api (red ${cfg.deployments.network}, factory ${cfg.deployments.factory ?? "sin desplegar"})`);
});
