// FakeWallet: misma interfaz que la wallet real, sin passkeys ni red. Para P4 mientras no hay testnet
// y para los tests. No verifica ni firma nada.
import { WalletError, type WalletErrorCode } from "./errors";
import type { SignAndSendOptions, Wallet } from "./types";

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

// C-address válida (strkey: versión 'C' + payload + CRC16-XModem, en base32) sin depender de Buffer,
// que no existe en el navegador.
function randomContractAddress(): string {
  const payload = randomBytes(32);
  const data = new Uint8Array(35);
  data[0] = 2 << 3; // versión de contrato → 'C'
  data.set(payload, 1);
  let crc = 0;
  for (const byte of data.subarray(0, 33)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  data[33] = crc & 0xff;
  data[34] = crc >> 8;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

function randomHash(): string {
  return Array.from(randomBytes(32), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class FakeWallet implements Wallet {
  private address: string | null = null;
  private nextError: WalletErrorCode | null = null;

  constructor(private readonly delayMs = 400) {}

  // Hace que la próxima llamada falle con ese código, para probar los estados de error de la UI.
  failNext(code: WalletErrorCode): void {
    this.nextError = code;
  }

  private async step(): Promise<void> {
    await new Promise((r) => setTimeout(r, this.delayMs));
    const code = this.nextError;
    if (code) {
      this.nextError = null;
      throw new WalletError(code);
    }
  }

  async createAccount(_displayName: string): Promise<{ address: string }> {
    await this.step();
    this.address = randomContractAddress();
    return { address: this.address };
  }

  async connect(): Promise<{ address: string } | null> {
    return this.address ? { address: this.address } : null;
  }

  async signAndSend(_tx: unknown, opts: SignAndSendOptions = {}): Promise<{ hash: string }> {
    if (!this.address) throw new WalletError("NOT_CONNECTED");
    opts.onPhase?.("verifying");
    opts.onPhase?.("signing");
    await this.step();
    opts.onPhase?.("submitting");
    return { hash: randomHash() };
  }

  async disconnect(): Promise<void> {
    this.address = null;
  }
}
