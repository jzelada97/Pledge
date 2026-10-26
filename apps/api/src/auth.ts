// Autenticación por API key (security AUTH-9, INTERFACES § 8.7): `x-api-key: <id>.<secret>`. Se guarda
// `sha256(secret)` y se compara en tiempo constante sobre digests de longitud fija. La key solo va en la
// cabecera: en la query se rechaza. Se registra solo el id. Tras 10 fallos por IP y minuto, 429.
// Los builds no requieren key (la cadena aplica require_auth); la key solo da cupo propio y scopes.
import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { ApiConfig, ApiKey } from "./config";
import { FixedWindow, clientIp, tooManyRequests } from "./limits";
import { Problem } from "./problem";

const MINUTE = 60_000;
export const MAX_AUTH_FAILURES_PER_MINUTE = 10;
const QUERY_KEY_NAMES = ["x-api-key", "api_key", "apiKey", "apikey"];
const ZERO_DIGEST = Buffer.alloc(32);

export const unauthorized = (detail: string) => new Problem(401, "AUTH_INVALID_API_KEY", "API key no válida", detail);

export function sha256Hex(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

// Misma duración tanto si el id existe como si no, y tanto si el hash guardado está bien formado como si no.
function secretMatches(secret: string, storedHex: string | undefined): boolean {
  const given = createHash("sha256").update(secret).digest();
  const stored = storedHex && /^[0-9a-f]{64}$/i.test(storedHex) ? Buffer.from(storedHex, "hex") : null;
  const equal = timingSafeEqual(given, stored ?? ZERO_DIGEST);
  return stored !== null && equal;
}

/** La key del cabecera si es válida; si no, null. Nunca lanza. */
export function verifyApiKey(keys: ApiKey[], header: string): ApiKey | null {
  const dot = header.indexOf(".");
  if (dot <= 0 || dot === header.length - 1) return null;
  const id = header.slice(0, dot);
  const key = keys.find((k) => k.id === id);
  return secretMatches(header.slice(dot + 1), key?.secretSha256) && key ? key : null;
}

type Env = { Variables: { traceId: string; apiKey: ApiKey | null } };

export function apiKeyAuth(cfg: ApiConfig, now: () => number = Date.now): MiddlewareHandler<Env> {
  const failures = new FixedWindow(MINUTE, now);
  return async (c, next) => {
    c.set("apiKey", null);
    for (const name of QUERY_KEY_NAMES) {
      if (c.req.query(name) !== undefined) {
        throw unauthorized("La API key solo se acepta en la cabecera x-api-key, nunca en la URL");
      }
    }
    // Sesiones de wallet de TW: no en el MVP (INTERFACES § 8.7).
    if (c.req.header("authorization")?.toLowerCase().startsWith("bearer ")) {
      throw new Problem(401, "AUTH_SESSION_NOT_CONFIGURED", "Las sesiones de wallet no están disponibles", "Usa x-api-key o la misma origin");
    }
    const header = c.req.header("x-api-key");
    if (header === undefined) return next();

    const ip = clientIp(c.req.raw);
    if (!failures.check(ip, MAX_AUTH_FAILURES_PER_MINUTE)) throw tooManyRequests("Demasiados intentos de autenticación desde esta IP");
    const key = verifyApiKey(cfg.apiKeys, header);
    if (!key) {
      failures.allow(ip, MAX_AUTH_FAILURES_PER_MINUTE);
      console.warn(`[api ${c.get("traceId")}] API key rechazada (id: ${header.split(".")[0]?.slice(0, 32) ?? "?"})`);
      throw unauthorized("API key desconocida o secreto incorrecto");
    }
    c.set("apiKey", key);
    await next();
  };
}
