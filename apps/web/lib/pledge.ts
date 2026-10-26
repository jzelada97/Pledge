"use client";

// Conexión real de la web con la lógica (plan A, MVP de la hackatón): wallet con passkey, ramp simulado y
// la API de apps/api montada en /api (misma origin). Ver docs/CONECTAR-FRONT.md.
import { createSimulatedAnchor } from "@fianzas/anchor";
import { createWallet, type UnsignedTransactionResponse, type Wallet } from "@fianzas/wallet";
import testnet from "../../../deployments/testnet.json";

// Comisión de TW en testnet (TW_FEE_ADDRESS_TESTNET de @fianzas/trustless): release_funds la recibe como argumento.
const TW_FEE_ADDRESS = "GBPUACN7QETR4TCYTKINBDHTYTFXD3BQQV7VSMZC5CX74E4MTUL2AMUB";
const SR = "/api/escrow/single-release/v2";

// Escrows que esta sesión ha visto salir de nuestra API: la wallet solo firma llamadas a ellos.
const knownEscrows = new Set<string>();

let wallet: Wallet | null = null;
export function getWallet(): Wallet {
  wallet ??= createWallet({
    rpcUrl: testnet.rpcUrl,
    networkPassphrase: testnet.networkPassphrase,
    rpId: location.hostname,
    rpName: "Pledge",
    accountWasmHash: testnet.smartAccount.accountWasmHash,
    webauthnVerifierAddress: testnet.smartAccount.webauthnVerifier,
    relayPath: "/api/fianzas/v1/relay",
    factory: "",
    token: testnet.token,
    isRegisteredEscrow: async () => false,
    trustless: { isEscrow: async (addr) => knownEscrows.has(addr), feeAddress: TW_FEE_ADDRESS },
  });
  return wallet;
}

const ADDRESS_KEY = "pledge.address";

/** Cuenta con passkey: reconecta la que haya o crea una nueva. Devuelve su dirección C…. */
export async function ensureAccount(displayName = "Pledge"): Promise<string> {
  const w = getWallet();
  const r = (await w.connect()) ?? (await w.createAccount(displayName));
  try {
    localStorage.setItem(ADDRESS_KEY, r.address);
  } catch {}
  return r.address;
}

export function savedAddress(): string | null {
  try {
    return localStorage.getItem(ADDRESS_KEY);
  } catch {
    return null;
  }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.detail ?? json.title ?? `Error ${res.status}`);
  return json as T;
}

/** Dinero de prueba desde el "banco" (ramp simulado). */
export async function addTestMoney(address: string, amount: string): Promise<void> {
  const anchor = createSimulatedAnchor({ rampPath: "/api/fianzas/v1/ramp" });
  await anchor.startDeposit(address, "USDC", amount);
}

/** Crea el escrow de TW (firma la tesorería en el servidor). */
export async function createFianza(landlord: string, tenant: string, amount: string): Promise<string> {
  const r = await api<{ contractId: string | null }>("/api/fianzas/v1/fianzas", { landlord, tenant, amount });
  if (!r.contractId) throw new Error("La API no devolvió el escrow");
  knownEscrows.add(r.contractId);
  return r.contractId;
}

async function signAndIndex(res: UnsignedTransactionResponse, opts: { contractId: string; amount?: bigint }): Promise<string> {
  knownEscrows.add(opts.contractId);
  const { hash } = await getWallet().signAndSendBuilt(res, {
    expectedContract: opts.contractId,
    ...(opts.amount !== undefined ? { expectedTransferAmount: opts.amount } : {}),
  });
  await api("/api/fianzas/v1/indexer", { txHash: hash }).catch(() => undefined);
  return hash;
}

const toStroops = (amount: string) => {
  const [w, f = ""] = amount.split(".");
  return BigInt(w) * 10_000_000n + BigInt((f + "0000000").slice(0, 7));
};

/** El inquilino deposita la fianza en el escrow (firma con la passkey; paga el Relayer). */
export async function fundFianza(contractId: string, tenant: string, amount: string): Promise<string> {
  const res = await api<UnsignedTransactionResponse>(`${SR}/fund`, { contractId, signer: tenant, amount });
  return signAndIndex(res, { contractId, amount: toStroops(amount) });
}

/** El casero aprueba la devolución. */
export async function approveRelease(contractId: string, landlord: string): Promise<string> {
  const res = await api<UnsignedTransactionResponse>(`${SR}/approve-milestones`, { contractId, approver: landlord, milestoneIndexes: [0] });
  return signAndIndex(res, { contractId });
}

/** El inquilino recupera la fianza (tras la aprobación del casero). */
export async function releaseFianza(contractId: string, tenant: string): Promise<string> {
  const res = await api<UnsignedTransactionResponse>(`${SR}/approve-and-release-milestones`, { contractId, signer: tenant, milestoneIndexes: [0] });
  return signAndIndex(res, { contractId });
}

export type FianzaView = Record<string, unknown> & { contractId: string; status: string; amount: string };

export const listFianzas = (role: "landlords" | "tenants", address: string) =>
  api<{ data: FianzaView[] }>(`/api/fianzas/v1/${role}/${address}/fianzas`).then((r) => r.data);
