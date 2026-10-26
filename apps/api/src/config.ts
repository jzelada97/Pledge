// Configuración de la API: deployments/testnet.json (anclas de confianza empaquetadas) + variables
// de entorno del servidor. Ninguna variable lleva NEXT_PUBLIC_: nada de esto llega al navegador.
import type { RelayPolicy } from "@fianzas/wallet/server";
import { TW_ESCROW_WASM_TESTNET } from "@fianzas/trustless";
import testnet from "../../../deployments/testnet.json";

export interface StrategyDeployment {
  id: string;
  kind: "defindex" | "noyield";
  vault: string | null;
  risk: "noyield" | "standard" | "high";
  simulated: boolean;
  default: boolean;
  vaultName?: string;
  vaultSymbol?: string;
  vaultManager?: string;
  vaultFeeBps?: number;
  protocolFeeBps?: number;
  defindexStrategy?: string;
  apyPool?: string | null;
  assetName?: string;
}

export interface Deployments {
  network: string;
  rpcUrl: string;
  networkPassphrase: string;
  startLedger: number;
  factory: string | null;
  escrowWasmHash: string | null;
  escrowWasmHashesAllowed: string[];
  token: string;
  tokenCode: string;
  tokenIssuer: string;
  strategies: StrategyDeployment[];
  admin: string;
  staff: string[];
  treasury: string;
  platformFeeBps: number;
  twFeeBps: number;
  twFeeReceiver: string | null;
  tenantYieldBps: number;
  faucet: string;
  readSource: string;
  relayer: string;
  smartAccount: { accountWasmHash: string; webauthnVerifier: string; deployers: string[] };
  anchor: { mode: "simulated" | "sep24"; homeDomain: string };
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  secretSha256: string;
  label: string;
  landlords: string[];
  scopes: Array<"read" | "build" | "submit">;
  rpm: number;
  origins?: string[];
}

/** Plan A: la API con rendimiento de Trustless Work (TrustYield). Solo servidor. */
export interface TrustlessConfig {
  apiKey: string;
  baseUrl?: string;
  /** Cuenta G de la tesorería que firma los despliegues en el servidor (decisión 1 de #84). */
  treasurySecret: string | null;
  /** Comisión de plataforma sobre el rendimiento sobrante tras resolver (bps). 0 hasta que el equipo decida. */
  platformFeeBps: number;
  /**
   * Liberación a plazo (#115): cuenta G del staff con la que el servidor resuelve a favor del inquilino
   * cuando ha pasado el plazo y el casero no ha aprobado ni parado. Sin ella, la API devuelve el XDR
   * para que el staff lo firme a mano.
   */
  staffSecret: string | null;
  /** Segundos tras `endTs` a partir de los cuales el inquilino puede reclamar (producción 30 días; demo 120). */
  claimTimeoutSecs: number;
}

export const DEFAULT_CLAIM_TIMEOUT_SECS = 30 * 24 * 3600;

export type Backend = "trustless" | "factory";

export interface ApiConfig {
  deployments: Deployments;
  rpcUrl: string;
  networkPassphrase: string;
  readSource: string;
  allowedOrigins: string[];
  relayer: { url: string; apiKey: string } | null;
  ramp: { faucetSecret: string; enabled: boolean } | null;
  apiKeys: ApiKey[];
  trustless: TrustlessConfig | null;
  /** Qué hay detrás de /fianzas/v1: plan A (TW) por defecto si hay TW_API_KEY; el plan B queda en reserva. */
  backend: Backend;
}

export const deployments = testnet as unknown as Deployments;

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env, dep: Deployments = deployments): ApiConfig {
  const origins = (env.API_ALLOWED_ORIGINS ?? "http://localhost:3000,http://localhost:3001")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let apiKeys: ApiKey[] = [];
  if (env.API_KEYS_JSON) {
    try {
      apiKeys = JSON.parse(env.API_KEYS_JSON) as ApiKey[];
    } catch {
      throw new Error("API_KEYS_JSON no es JSON válido");
    }
  }
  return {
    deployments: dep,
    rpcUrl: env.SOROBAN_RPC_URL ?? dep.rpcUrl,
    networkPassphrase: env.NETWORK_PASSPHRASE ?? dep.networkPassphrase,
    readSource: env.READ_SOURCE ?? dep.readSource,
    allowedOrigins: origins,
    relayer: env.RELAYER_API_KEY ? { url: env.RELAYER_URL ?? dep.relayer, apiKey: env.RELAYER_API_KEY } : null,
    ramp: env.RAMP_FAUCET_SECRET ? { faucetSecret: env.RAMP_FAUCET_SECRET, enabled: env.RAMP_ENABLED !== "false" } : null,
    apiKeys,
    trustless: env.TW_API_KEY
      ? {
          apiKey: env.TW_API_KEY,
          baseUrl: env.TW_API_URL,
          treasurySecret: env.TREASURY_SECRET ?? null,
          platformFeeBps: Number(env.TW_PLATFORM_FEE_BPS ?? 0),
          staffSecret: env.STAFF_SECRET ?? null,
          claimTimeoutSecs: Number(env.TW_CLAIM_TIMEOUT_SECS ?? DEFAULT_CLAIM_TIMEOUT_SECS),
        }
      : null,
    backend: env.FIANZAS_BACKEND === "factory" ? "factory" : env.FIANZAS_BACKEND === "trustless" || env.TW_API_KEY ? "trustless" : "factory",
  };
}

// Política del Relayer (arquitectura § 8.2 y security N-3). Solo contratos nuestros, solo las funciones
// que firma un usuario con passkey; las de staff y admin nunca pasan por aquí.
export function relayPolicy(cfg: ApiConfig): RelayPolicy {
  const d = cfg.deployments;
  return {
    fixedContracts: d.factory ? { [d.factory]: ["create_fianza"] } : {},
    escrow: {
      wasmHashes: d.escrowWasmHashesAllowed,
      factory: d.factory ?? "",
      functions: ["cancel", "fund_escrow", "approve_release", "stop", "claim_after_timeout", "claim_after_review_timeout"],
    },
    // Plan A: escrows de TW, reconocidos por su wasm; solo las funciones que firma un usuario (#66).
    externalEscrows:
      d.network === "testnet"
        ? { wasmHashes: [TW_ESCROW_WASM_TESTNET], functions: ["fund_escrow", "approve_milestone", "release_funds", "dispute_escrow"] }
        : undefined,
    token: d.token,
    createContractWasmHashes: [d.smartAccount.accountWasmHash],
    smartAccountDeployers: d.smartAccount.deployers,
    allowedOrigins: cfg.allowedOrigins,
    maxResourceFeeStroops: 10_000_000n, // 1 XLM por transacción
    maxRequestsPerMinutePerIp: 30,
    maxRequestsPerMinutePerCredential: 10,
    maxCreateFianzaPerHourPerCredential: 5,
    globalHourlyCap: 600,
  };
}
