import type { contract } from "@stellar/stellar-sdk";

// Fases de signAndSend, para que la UI muestre en qué punto está.
export type SignPhase = "verifying" | "signing" | "submitting";

export interface SignAndSendOptions {
  onPhase?: (phase: SignPhase) => void;
  // Importe exacto de la transferencia anidada en `stop` (terms.stop_bond). Obligatorio para `stop`:
  // sin él no se puede comprobar el árbol de auth (security WEB-3).
  expectedTransferAmount?: bigint;
}

// Respuesta de los builds de apps/api (INTERFACES § 8): la de TW más la extensión `soroban`.
export interface UnsignedTransactionResponse {
  unsignedXdr: string; // firmable tal cual solo si el firmante es una cuenta G
  txHash: string;
  contractId?: string | null;
  soroban?: {
    // solo si el firmante es una C-address (passkey)
    func: string; // base64 XDR HostFunction
    auth: string[]; // base64 SorobanAuthorizationEntry sin firmar
    validUntilLedger: number; // latestLedger + 60
  };
}

export interface SignBuiltOptions extends SignAndSendOptions {
  // Solo para builds sin `soroban` (cuenta G, p. ej. Freighter): firma el XDR y devuelve el XDR firmado.
  signXdr?: (unsignedXdr: string) => Promise<string>;
}

// API pública que consume P4 (INTERFACES § 10).
export interface Wallet {
  createAccount(displayName: string): Promise<{ address: string }>; // passkey nueva → C-address
  connect(): Promise<{ address: string } | null>; // reconexión silenciosa
  signAndSend(tx: contract.AssembledTransaction<unknown>, opts?: SignAndSendOptions): Promise<{ hash: string }>; // fees vía Relayer
  // Firma lo que construye apps/api: con `soroban`, las auth entries con la passkey y envío por relayPath;
  // sin él, el XDR con opts.signXdr y envío por sendTransactionPath.
  signAndSendBuilt(res: UnsignedTransactionResponse, opts?: SignBuiltOptions): Promise<{ hash: string }>;
  disconnect(): Promise<void>;
}

// Lo que la wallet necesita saber de nuestros contratos para verificar lo que firma.
export interface ContractsConfig {
  factory: string; // deployments.factory
  token: string; // deployments.token (SAC de USDC)
  // true si `addr` es un escrow registrado en la factory (factory.id_of(addr) no da NotFound).
  isRegisteredEscrow(addr: string): Promise<boolean>;
}

export interface WalletConfig extends ContractsConfig {
  rpcUrl: string;
  networkPassphrase: string;
  rpId: string; // hostname exacto del despliegue (security AUTH-6)
  rpName: string; // nombre que ve el usuario al crear la passkey
  accountWasmHash: string; // deployments.smartAccount.accountWasmHash
  webauthnVerifierAddress: string; // deployments.smartAccount.webauthnVerifier
  relayPath: string; // "/api/fianzas/v1/relay" (createRelayHandler montado en apps/api)
  sendTransactionPath?: string; // por defecto "/api/stellar/send-transaction"
}
