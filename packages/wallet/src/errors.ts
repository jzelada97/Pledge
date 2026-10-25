// Errores de la wallet con un `code` estable. P4 traduce cada código a un texto para el usuario
// (INTERFACES § 8). Nunca se muestran términos cripto ni trazas.

export type WalletErrorCode =
  | "USER_CANCELLED" // el usuario cerró el diálogo de la passkey
  | "WRONG_ORIGIN" // location.hostname !== cfg.rpId (security AUTH-6)
  | "NOT_CONNECTED" // se pidió firmar sin cuenta conectada
  | "SIMULATION_FAILED" // la simulación devolvió un error del contrato (lleva contractError)
  | "AUTH_MISMATCH" // el árbol de auth no es el esperado: no se firma (security WEB-3)
  | "RELAYER_DOWN" // /api/relay o Channels no responden
  | "RATE_LIMITED" // 429 del handler
  | "TX_FAILED"; // la red rechazó la transacción

export class WalletError extends Error {
  readonly code: WalletErrorCode;
  readonly contractError?: number;

  constructor(code: WalletErrorCode, message?: string, contractError?: number) {
    super(message ?? code);
    this.name = "WalletError";
    this.code = code;
    this.contractError = contractError;
  }
}

export function isWalletError(e: unknown): e is WalletError {
  return e instanceof WalletError;
}
