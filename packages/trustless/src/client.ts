// Cliente de la API con rendimiento de Trustless Work (single-release v1 + vault de DeFindex).
// Solo servidor: lleva la API key. Cada escritura devuelve `{ unsignedTransaction }` para firmar en el
// cliente y enviarlo con `sendTransaction`.
import type {
  ApiErrorBody,
  ApproveMilestoneBody,
  DeployBody,
  DisputeBody,
  DistributionsBody,
  Escrow,
  EscrowBalance,
  FundBody,
  ReleaseFundsBody,
  SendTransactionResponse,
  UnsignedTransactionResponse,
  VaultPosition,
} from "./types";

export const TW_YIELD_URL = "https://trustless-backend-production.up.railway.app";
const SINGLE_RELEASE = "/escrow/single-release";

export interface TrustlessClientConfig {
  apiKey: string;
  baseUrl?: string;
  /** Inyectable para tests. */
  fetch?: typeof fetch;
}

export class TrustlessApiError extends Error {
  readonly status: number;
  readonly body?: ApiErrorBody;

  constructor(status: number, body?: ApiErrorBody) {
    const message = Array.isArray(body?.message) ? body.message.join("; ") : body?.message;
    super(message ?? `Trustless Work respondió ${status}`);
    this.name = "TrustlessApiError";
    this.status = status;
    this.body = body;
  }
}

export type TrustlessClient = ReturnType<typeof createTrustlessClient>;

// La API exige `?clave[]=valor` aunque sea un solo valor (`?addresses=C…` da 400).
function arrayQuery(key: string, values: string[]): string {
  return values.map((v) => `${key}[]=${encodeURIComponent(v)}`).join("&");
}

export function createTrustlessClient(config: TrustlessClientConfig) {
  if (!config.apiKey) throw new Error("Falta la API key de Trustless Work");
  const base = (config.baseUrl ?? TW_YIELD_URL).replace(/\/+$/, "");
  const doFetch = config.fetch ?? fetch;

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-api-key": config.apiKey },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (!res.ok) throw new TrustlessApiError(res.status, data as ApiErrorBody | undefined);
    return data as T;
  }

  const write = (path: string, body: unknown) => call<UnsignedTransactionResponse>("POST", path, body);

  return {
    deploy: (body: DeployBody) => write("/deployer/single-release", body),
    fund: (body: FundBody) => write(`${SINGLE_RELEASE}/fund-escrow`, body),
    approveMilestone: (body: ApproveMilestoneBody) => write(`${SINGLE_RELEASE}/approve-milestone`, body),
    releaseFunds: (body: ReleaseFundsBody) => write(`${SINGLE_RELEASE}/release-funds`, body),
    dispute: (body: DisputeBody) => write(`${SINGLE_RELEASE}/dispute-escrow`, body),
    resolveDispute: (body: DistributionsBody) => write(`${SINGLE_RELEASE}/resolve-dispute`, body),
    withdrawRemainingFunds: (body: DistributionsBody) => write(`${SINGLE_RELEASE}/withdraw-remaining-funds`, body),
    // Con la lista vacía la query quedaría mal formada: no se llama a la API.
    getEscrows: async (contractIds: string[]): Promise<Escrow[]> =>
      contractIds.length === 0
        ? []
        : call<Escrow[]>("GET", `/helper/get-escrow-by-contract-ids?${arrayQuery("contractIds", contractIds)}&validateOnChain=true`),
    getBalances: async (addresses: string[]): Promise<EscrowBalance[]> =>
      addresses.length === 0
        ? []
        : call<EscrowBalance[]>("GET", `/helper/get-multiple-escrow-balance?${arrayQuery("addresses", addresses)}`),
    vaultPosition: (contractId: string) =>
      call<VaultPosition>("GET", `${SINGLE_RELEASE}/vault-position?contractId=${encodeURIComponent(contractId)}`),
    sendTransaction: (signedXdr: string) => call<SendTransactionResponse>("POST", "/helper/send-transaction", { signedXdr }),
  };
}
