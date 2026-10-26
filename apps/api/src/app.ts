// createApp: la API entera como una app Hono con basePath /api (se monta en apps/web o en dev.ts).
import { Hono } from "hono";
import { createRelayHandler } from "@fianzas/wallet/server";
import { createSimRampHandler } from "@fianzas/anchor/server";
import { apiKeyAuth } from "./auth";
import { createChain, TtlCache, type Chain } from "./chain";
import { relayPolicy, type ApiConfig, type ApiKey } from "./config";
import { rateLimits } from "./limits";
import { createTwClient } from "./plan-a/client";
import { planARoutes } from "./plan-a/routes";
import { notFound, Problem, problemResponse, serviceDisabled, validationError } from "./problem";
import { fianzasRoutes } from "./routes/fianzas";
import { stellarRoutes } from "./routes/stellar";
import { twRoutes } from "./routes/tw";

export interface AppDeps {
  chain?: Chain; // para tests
  now?: () => number;
  twFetch?: typeof fetch; // para tests: la API de Trustless Work simulada
}

type Env = { Variables: { traceId: string; apiKey: ApiKey | null } };

const TRACE_ID_RE = /^[\w-]{1,64}$/;

export function createApp(cfg: ApiConfig, deps: AppDeps = {}) {
  const chain = deps.chain ?? createChain(cfg);
  const cache = new TtlCache(deps.now);
  const app = new Hono<Env>().basePath("/api");

  app.use("*", async (c, next) => {
    // Se acepta el trace-id del cliente solo si es inofensivo para logs y cabeceras (API-12).
    const given = c.req.header("x-trace-id");
    c.set("traceId", given && TRACE_ID_RE.test(given) ? given : crypto.randomUUID());
    await next();
    c.header("x-trace-id", c.get("traceId"));
  });
  // Auth y límites (security AUTH-9, INTERFACES § 8.7): relay y ramp traen los suyos.
  app.use("*", apiKeyAuth(cfg, deps.now));
  app.use("*", rateLimits(deps.now));

  app.onError((err, c) => {
    if (err instanceof Problem) {
      if (err.internal) console.error(`[api ${c.get("traceId")}] ${err.code}: ${err.internal}`);
      return problemResponse(c, err);
    }
    if (err instanceof SyntaxError) return problemResponse(c, validationError("JSON mal formado"));
    console.error(`[api ${c.get("traceId")}]`, err);
    return problemResponse(c, new Problem(500, "INTERNAL_ERROR", "Error interno"));
  });
  app.notFound((c) => problemResponse(c, notFound()));

  app.get("/health", (c) =>
    c.json({
      ok: true,
      network: cfg.deployments.network,
      backend: cfg.backend,
      factory: cfg.deployments.factory,
      trustless: cfg.trustless !== null,
      relayer: cfg.relayer !== null,
      ramp: cfg.ramp?.enabled ?? false,
      updatedAt: cfg.deployments.updatedAt,
    }),
  );

  const tw = cfg.backend === "trustless" && cfg.trustless ? createTwClient(cfg.trustless, deps.twFetch) : null;
  app.route("/", stellarRoutes(cfg, chain, cache, tw));
  // Plan A (TW) por defecto; el plan B (factory propia) queda detrás, en reserva, y sigue sirviendo
  // lo que el plan A no cubre (estrategias, precio por share). Hono atiende la primera ruta que encaja.
  if (cfg.backend === "trustless") app.route("/", planARoutes(cfg, tw, chain, cache, deps.now));
  app.route("/", fianzasRoutes(cfg, chain, cache));
  app.route("/", twRoutes(cfg, chain, cache));

  // Relayer: único camino patrocinado, solo para C-addresses con passkey (arquitectura § 6.8.4).
  if (cfg.relayer) {
    const relay = createRelayHandler({
      policy: relayPolicy(cfg),
      relayerUrl: cfg.relayer.url,
      apiKey: cfg.relayer.apiKey,
      rpcUrl: cfg.rpcUrl,
      networkPassphrase: cfg.networkPassphrase,
      now: deps.now,
    });
    app.post("/fianzas/v1/relay", (c) => relay(c.req.raw));
  } else {
    app.post("/fianzas/v1/relay", () => {
      throw serviceDisabled("Relayer no configurado (RELAYER_API_KEY)");
    });
  }

  // Ramp simulado (plan B del anchor), solo en testnet y con la cuenta faucet acotada.
  if (cfg.ramp && cfg.deployments.network !== "mainnet") {
    const ramp = createSimRampHandler({
      networkPassphrase: cfg.networkPassphrase,
      rpcUrl: cfg.rpcUrl,
      faucetSecret: cfg.ramp.faucetSecret,
      token: cfg.deployments.token,
      accountWasmHashes: [cfg.deployments.smartAccount.accountWasmHash],
      enabled: cfg.ramp.enabled,
      allowedOrigins: cfg.allowedOrigins,
      maxAmount: "100",
      perAddressCap: "500",
      perIpPerHour: 5,
      globalHourlyCap: 50,
      now: deps.now,
    });
    app.post("/fianzas/v1/ramp", (c) => ramp.POST(c.req.raw));
    app.get("/fianzas/v1/ramp", (c) => ramp.GET(c.req.raw));
  } else {
    app.all("/fianzas/v1/ramp", () => {
      throw serviceDisabled("Ramp simulado no configurado (RAMP_FAUCET_SECRET)");
    });
  }

  return app;
}

export type App = ReturnType<typeof createApp>;
