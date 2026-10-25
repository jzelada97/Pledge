// Configuración de la API: deployments/testnet.json (anclas de confianza empaquetadas) + variables
// de entorno del servidor. Ninguna variable lleva NEXT_PUBLIC_: nada de esto llega al navegador.
import type { RelayPolicy } from "@fianzas/wallet/server";
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

export interface ApiConfig {
  deployments: Deployments;
  rpcUrl: string;
  networkPassphrase: string;
  readSource: string;
  allowedOrigins: string[];
  relayer: { url: string; apiKey: string } | null;
  ramp: { faucetSecret: string; enabled: boolean } | null;
  apiKeys: ApiKey[];
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
