// Límites de peticiones (INTERFACES § 8.7): ventana fija en memoria, por instancia (limitación
// aceptada en la arquitectura; [M] KV compartido). Cada build simula contra la RPC y cada lectura la
// consulta, así que sin límite cualquiera agota la cuota del RPC. /relay y /ramp tienen los suyos.
import type { MiddlewareHandler } from "hono";
import type { ApiKey } from "./config";
import { Problem } from "./problem";

const MINUTE = 60_000;

export const LIMITS = {
  readsPerMinutePerIp: 120,
  buildsPerMinutePerIp: 30,
  defaultKeyRpm: 300,
} as const;

export const tooManyRequests = (detail?: string) => new Problem(429, "TOO_MANY_REQUESTS", "Demasiadas peticiones", detail);

/** Ventana fija: `check` mira si queda cupo sin gastarlo; `allow` lo consume. */
export class FixedWindow {
  private readonly hits = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string, limit: number): boolean {
    const cur = this.hits.get(key);
    return !cur || this.now() - cur.start >= this.windowMs || cur.count < limit;
  }

  allow(key: string, limit: number): boolean {
    const t = this.now();
    const cur = this.hits.get(key);
    if (!cur || t - cur.start >= this.windowMs) {
      this.hits.set(key, { start: t, count: 1 });
      return true;
    }
    if (cur.count >= limit) return false;
    cur.count += 1;
    return true;
  }
}

// IP que pone la plataforma (security CS-4): x-real-ip de Vercel, o el primer valor de x-forwarded-for.
export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export type RouteClass = "read" | "build" | "submit" | "own";

/** Clase de la ruta para límites y scopes. `own`: la ruta trae sus propios límites (relay, ramp). */
export function classifyRoute(method: string, path: string): RouteClass {
  if (path === "/api/fianzas/v1/relay" || path === "/api/fianzas/v1/ramp") return "own";
  if (path === "/api/stellar/send-transaction") return "submit";
  return method === "GET" || method === "HEAD" ? "read" : "build";
}

type Env = { Variables: { traceId: string; apiKey: ApiKey | null } };

/**
 * Límite por IP para peticiones anónimas (lecturas 120/min, builds y envíos 30/min) y por key para las
 * autenticadas (`rpm` de la key). Va después de `apiKeyAuth`. Las keys además necesitan el scope de la
 * clase de ruta: `read`, `build` o `submit`.
 */
export function rateLimits(now: () => number = Date.now): MiddlewareHandler<Env> {
  const perIp = new FixedWindow(MINUTE, now);
  const perKey = new FixedWindow(MINUTE, now);
  return async (c, next) => {
    const cls = classifyRoute(c.req.method, c.req.path);
    if (cls === "own") return next();
    const key = c.get("apiKey");
    if (key) {
      if (!key.scopes.includes(cls)) {
        throw new Problem(403, "AUTH_INSUFFICIENT_SCOPE", "La API key no tiene permiso para esta ruta", `hace falta el scope "${cls}"`);
      }
      if (!perKey.allow(`key:${key.id}`, key.rpm || LIMITS.defaultKeyRpm)) throw tooManyRequests("Cupo de la API key agotado");
      return next();
    }
    const limit = cls === "read" ? LIMITS.readsPerMinutePerIp : LIMITS.buildsPerMinutePerIp;
    if (!perIp.allow(`${cls === "read" ? "read" : "build"}:${clientIp(c.req.raw)}`, limit)) {
      throw tooManyRequests(cls === "read" ? "Demasiadas lecturas desde esta IP" : "Demasiadas transacciones construidas desde esta IP");
    }
    return next();
  };
}
