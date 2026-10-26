// Cliente de la API con rendimiento de Trustless Work para apps/api: el de @fianzas/trustless más las
// listas por rol, que el paquete aún no expone (issue abierto para P1). La API key nunca sale del servidor.
import { TW_YIELD_URL, TrustlessApiError, createTrustlessClient, type Escrow, type Roles } from "@fianzas/trustless";
import type { TrustlessConfig } from "../config";
import { Problem } from "../problem";

export type TwRole = keyof Roles;

export interface TwClient extends ReturnType<typeof createTrustlessClient> {
  /** Escrows en los que `address` tiene el rol (`GET /helper/get-escrows-by-role`). */
  getEscrowsByRole(role: TwRole, address: string): Promise<Escrow[]>;
  /**
   * Avisa al indexador de TW de una transacción enviada por otra vía (nuestra RPC o el Relayer):
   * su base de datos solo se actualiza sola con su propio `send-transaction`.
   */
  indexTransaction(txHash: string): Promise<void>;
}

export function createTwClient(cfg: TrustlessConfig, fetchImpl: typeof fetch = fetch): TwClient {
  const base = (cfg.baseUrl ?? TW_YIELD_URL).replace(/\/+$/, "");
  const inner = createTrustlessClient({ apiKey: cfg.apiKey, baseUrl: base, fetch: fetchImpl });

  async function raw(method: "GET" | "PUT", path: string, body?: unknown): Promise<unknown> {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-api-key": cfg.apiKey },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (!res.ok) throw new TrustlessApiError(res.status, data as never);
    return data;
  }

  return {
    ...inner,
    async getEscrowsByRole(role, address) {
      const q = new URLSearchParams({ role, roleAddress: address, type: "single-release", validateOnChain: "true" });
      const data = await raw("GET", `/helper/get-escrows-by-role?${q}`);
      return Array.isArray(data) ? (data as Escrow[]) : [];
    },
    async indexTransaction(txHash) {
      await raw("PUT", "/indexer/update-from-txhash", { txHash });
    },
  };
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
