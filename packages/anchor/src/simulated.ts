// Cliente del ramp simulado (plan B, [AD-8]): el "banco" es la cuenta faucet de /api/ramp, que envía
// USDC de testnet a la cuenta del usuario. La UI debe mostrar que es simulado (isSimulated).
import { isValidAmount } from "./amount";
import { AnchorError, type Anchor, type AnchorStatus } from "./types";

export interface SimulatedAnchorConfig {
  rampPath: string; // "/api/fianzas/v1/ramp" (createSimRampHandler montado en apps/api)
  fetch?: typeof fetch;
}

function errorFor(status: number): AnchorError {
  if (status === 429) return new AnchorError("RATE_LIMITED");
  if (status === 403) return new AnchorError("DISABLED");
  if (status === 400) return new AnchorError("INVALID_AMOUNT");
  return new AnchorError("RAMP_DOWN");
}

export function createSimulatedAnchor(cfg: SimulatedAnchorConfig): Anchor {
  const doFetch = cfg.fetch ?? fetch;
  return {
    isSimulated: true,

    async startDeposit(address, _assetCode, amount) {
      if (!amount || !isValidAmount(amount)) throw new AnchorError("INVALID_AMOUNT");
      let res: Response;
      try {
        res = await doFetch(cfg.rampPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: address, amount }),
        });
      } catch {
        throw new AnchorError("RAMP_DOWN");
      }
      if (!res.ok) throw errorFor(res.status);
      const { id } = (await res.json()) as { id: string };
      return { url: "", id };
    },

    async startWithdraw() {
      // El retiro al banco queda para el anchor real (SEP-24 + SEP-45). La UI oculta el botón.
      throw new AnchorError("NOT_SUPPORTED");
    },

    async status(id): Promise<AnchorStatus> {
      try {
        const res = await doFetch(`${cfg.rampPath}?id=${encodeURIComponent(id)}`);
        if (!res.ok) return "error";
        return ((await res.json()) as { status: AnchorStatus }).status;
      } catch {
        return "error";
      }
    },
  };
}
