// Cliente de la API REST v2 de Trustless Work (Single-Release). Solo servidor: lleva la
// API key. Cada escritura devuelve `{ unsignedXdr, txHash }` para firmar en el cliente.
import type {
  ApproveAndReleaseBody,
  ApproveMilestonesBody,
  DeployV2Body,
  DisputeBody,
  FundBody,
  ProblemDetails,
  ReleaseFundsBody,
  ResolveDisputeBody,
  SendTransactionResponse,
  SingleReleaseV2Escrow,
  UnsignedTransactionResponse,
} from "./types";

export const TW_BETA_URL = "https://beta.api.trustlesswork.com";
const SINGLE_RELEASE = "/escrow/single-release/v2";

export interface TrustlessClientConfig {
  apiKey: string;
  baseUrl?: string;
  /** Inyectable para tests. */
  fetch?: typeof fetch;
}

export class TrustlessApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly traceId?: string;
  readonly problem?: ProblemDetails;

  constructor(status: number, problem?: ProblemDetails) {
    super(problem?.detail ?? problem?.title ?? `Trustless Work respondió ${status}`);
    this.name = "TrustlessApiError";
    this.status = status;
    this.code = problem?.code;
    this.traceId = problem?.traceId;
    this.problem = problem;
  }
}

export type TrustlessClient = ReturnType<typeof createTrustlessClient>;

export function createTrustlessClient(config: TrustlessClientConfig) {
  if (!config.apiKey) throw new Error("Falta la API key de Trustless Work");
  const base = (config.baseUrl ?? TW_BETA_URL).replace(/\/+$/, "");
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
    if (!res.ok) throw new TrustlessApiError(res.status, data as ProblemDetails | undefined);
    return data as T;
  }

  const write = (path: string, body: unknown) =>
    call<UnsignedTransactionResponse>("POST", `${SINGLE_RELEASE}${path}`, body);

  return {
    deploy: (body: DeployV2Body) => write("/deploy", body),
    fund: (body: FundBody) => write("/fund", body),
    approveMilestones: (body: ApproveMilestonesBody) => write("/approve-milestones", body),
    approveAndReleaseMilestones: (body: ApproveAndReleaseBody) =>
      write("/approve-and-release-milestones", body),
    releaseFunds: (body: ReleaseFundsBody) => write("/release-funds", body),
    dispute: (body: DisputeBody) => write("/dispute", body),
    resolveDispute: (body: ResolveDisputeBody) => write("/resolve-dispute", body),
    getEscrow: (contractId: string) =>
      call<SingleReleaseV2Escrow>("GET", `${SINGLE_RELEASE}/${encodeURIComponent(contractId)}`),
    sendTransaction: (signedXdr: string) =>
      call<SendTransactionResponse>("POST", "/stellar/send-transaction", { signedXdr }),
  };
}
