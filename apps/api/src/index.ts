import { handle } from "hono/vercel";
import { createApp, type App, type AppDeps } from "./app";
import { deployments, loadConfigFromEnv, relayPolicy, type ApiConfig, type Deployments, type StrategyDeployment } from "./config";

export { createApp, loadConfigFromEnv, relayPolicy, deployments };
export type { App, AppDeps, ApiConfig, Deployments, StrategyDeployment };
export { Problem, type ProblemDetails } from "./problem";
export type { StrategyInfo } from "./routes/fianzas";

// Handlers para la ruta catch-all de Next (apps/web/app/api/[[...path]]/route.ts).
// Se crea la app una sola vez por proceso; la configuración sale del entorno del servidor.
export function nextHandlers(cfg: ApiConfig = loadConfigFromEnv()) {
  const h = handle(createApp(cfg));
  return { GET: h, POST: h, PUT: h, PATCH: h, DELETE: h, OPTIONS: h };
}
