import type { contract } from "@stellar/stellar-sdk";

// Fases de signAndSend, para que la UI muestre en qué punto está.
export type SignPhase = "verifying" | "signing" | "submitting";

export interface SignAndSendOptions {
  onPhase?: (phase: SignPhase) => void;
  // Importe exacto de la transferencia anidada en `stop` (terms.stop_bond). Obligatorio para `stop`:
  // sin él no se puede comprobar el árbol de auth (security WEB-3).
  expectedTransferAmount?: bigint;
}

// API pública que consume P4 (INTERFACES § 8).
export interface Wallet {
  createAccount(displayName: string): Promise<{ address: string }>; // passkey nueva → C-address
  connect(): Promise<{ address: string } | null>; // reconexión silenciosa
  signAndSend(tx: contract.AssembledTransaction<unknown>, opts?: SignAndSendOptions): Promise<{ hash: string }>; // fees vía Relayer
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
  relayerUrl: string; // normalmente "/api/relay" (createRelayHandler)
}
