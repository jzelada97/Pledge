// API pública del anchor (INTERFACES § 9). Con SEP-24 real, startDeposit devuelve la URL interactiva
// del anchor; con el ramp simulado (plan B), url = "" y el dinero llega sin salir de la app.
export type AnchorStatus = "pending" | "completed" | "error";

export interface Anchor {
  // `amount` en unidades del token ("12.5"). Lo usa el ramp simulado; en SEP-24 lo pide el anchor.
  startDeposit(address: string, assetCode: string, amount?: string): Promise<{ url: string; id: string }>;
  startWithdraw(address: string, assetCode: string, amount?: string): Promise<{ url: string; id: string }>;
  status(id: string): Promise<AnchorStatus>;
  isSimulated: boolean; // true en el plan B: la UI lo muestra
}

export type AnchorErrorCode = "NOT_SUPPORTED" | "INVALID_AMOUNT" | "RATE_LIMITED" | "DISABLED" | "RAMP_DOWN";

export class AnchorError extends Error {
  constructor(readonly code: AnchorErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AnchorError";
  }
}
