// FakeAnchor: misma interfaz, sin red. Para P4 mientras no hay testnet y para los tests.
import { isValidAmount } from "./amount";
import { AnchorError, type Anchor, type AnchorStatus } from "./types";

export class FakeAnchor implements Anchor {
  readonly isSimulated = true;
  private readonly started = new Map<string, number>();
  private seq = 0;

  constructor(private readonly delayMs = 1500) {}

  async startDeposit(_address: string, _assetCode: string, amount?: string): Promise<{ url: string; id: string }> {
    if (!amount || !isValidAmount(amount)) throw new AnchorError("INVALID_AMOUNT");
    const id = `fake-${++this.seq}`;
    this.started.set(id, Date.now());
    return { url: "", id };
  }

  async startWithdraw(): Promise<{ url: string; id: string }> {
    throw new AnchorError("NOT_SUPPORTED");
  }

  async status(id: string): Promise<AnchorStatus> {
    const t = this.started.get(id);
    if (t === undefined) return "error";
    return Date.now() - t >= this.delayMs ? "completed" : "pending";
  }
}
