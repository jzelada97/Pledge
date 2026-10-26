// Cliente de la API con rendimiento de Trustless Work para apps/api: el de @fianzas/trustless (listas por
// rol e indexador incluidos desde #99) y la traducción de sus errores a Problem Details. La API key
// nunca sale del servidor.
import { TW_YIELD_URL, TrustlessApiError, createTrustlessClient } from "@fianzas/trustless";
import type { TrustlessConfig } from "../config";
import { Problem } from "../problem";

export type TwClient = ReturnType<typeof createTrustlessClient>;

export function createTwClient(cfg: TrustlessConfig, fetchImpl: typeof fetch = fetch): TwClient {
  return createTrustlessClient({ apiKey: cfg.apiKey, baseUrl: (cfg.baseUrl ?? TW_YIELD_URL).replace(/\/+$/, ""), fetch: fetchImpl });
}

/** Errores de la API de TW → Problem Details, sin filtrar su cuerpo al cliente (API-12). */
export function twProblem(e: unknown): unknown {
  if (!(e instanceof TrustlessApiError)) return e;
  const internal = `TW ${e.status}: ${e.message}`;
  if (e.status === 404) return new Problem(404, "ESCROW_NOT_FOUND", "No existe esa fianza en Trustless Work", undefined, undefined, internal);
  if (e.status === 401 || e.status === 403) return new Problem(502, "FZ_TW_AUTH", "La API de Trustless Work rechazó la credencial del servidor", undefined, undefined, internal);
  if (e.status === 400 || e.status === 422) return new Problem(422, "FZ_TW_REJECTED", "Trustless Work rechazó la operación", e.message.slice(0, 200), undefined, internal);
  if (e.status === 429) return new Problem(503, "FZ_TW_RATE_LIMITED", "Trustless Work está limitando las peticiones; reinténtalo", undefined, undefined, internal);
  return new Problem(502, "FZ_TW_UNAVAILABLE", "Trustless Work no respondió bien", undefined, undefined, internal);
}

export async function withTw<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw twProblem(e);
  }
}
