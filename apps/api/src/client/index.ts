// Cliente tipado y fino de la API para apps/web y apps/backoffice. Para los endpoints compatibles con
// Trustless Work se puede usar también @trustless-work/escrow-js con baseURL = "<origin>/api".
import type { ProblemDetails } from "../problem";
import type { StrategyInfo } from "../routes/fianzas";

export type { ProblemDetails, StrategyInfo };

export interface ConfigInfo {
  source: "deployments" | "chain";
  factory: string | null;
  paused: boolean | null;
  escrowWasmHash: string | null;
  token: string;
  treasury: string;
  staff: string[];
  platformFeeBps: number;
  twFeeBps: number;
  twFeeReceiver: string | null;
  tenantYieldBps: number;
  configVersion: number | null; // null mientras no hay factory; FianzaParams.expected_config_version
  // Solo con source "chain":
  timeoutSecs?: number;
  reviewTimeoutSecs?: number;
  stopBondMin?: string; // stroops
  stopBondBps?: number;
  vaultManager?: string | null;
  network?: string;
  [k: string]: unknown;
}

export interface SendResult {
  txHash: string;
  ledger: number | null;
  status: string;
  code: "STELLAR_TX_SUBMITTED";
}

export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
  }
  get code() {
    return this.problem.code;
  }
  get status() {
    return this.problem.status;
  }
}

export interface ApiClient {
  health(): Promise<{ ok: boolean; network: string; factory: string | null }>;
  getConfig(): Promise<ConfigInfo>;
  getStrategies(): Promise<StrategyInfo[]>;
  getStrategyPrice(id: string): Promise<{ pricePerShare: string | null; asOf: string }>;
  sendTransaction(signedXdr: string): Promise<SendResult>;
}

export function createApiClient(baseUrl = "/api", fetchImpl: typeof fetch = fetch, apiKey?: string): ApiClient {
  const base = baseUrl.replace(/\/+$/, "");
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("accept", "application/json");
    if (apiKey) headers.set("x-api-key", apiKey);
    if (init?.body) headers.set("content-type", "application/json");
    const res = await fetchImpl(`${base}${path}`, { ...init, headers });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) throw new ApiError(json as ProblemDetails);
    return json as T;
  }
  return {
    health: () => call("/health"),
    getConfig: () => call("/fianzas/v1/config"),
    getStrategies: () => call("/fianzas/v1/strategies"),
    getStrategyPrice: (id) => call(`/fianzas/v1/strategies/${encodeURIComponent(id)}/price`),
    sendTransaction: (signedXdr) => call("/stellar/send-transaction", { method: "POST", body: JSON.stringify({ signedXdr }) }),
  };
}
