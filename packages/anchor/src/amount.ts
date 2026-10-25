// Importes en texto ("12.5") → stroops (7 decimales) con aritmética entera. Nunca parseFloat (security IV-6).
const AMOUNT_RE = /^\d{1,6}(\.\d{1,7})?$/;

export function isValidAmount(amount: string): boolean {
  return AMOUNT_RE.test(amount) && toStroops(amount) > 0n;
}

export function toStroops(amount: string): bigint {
  if (!AMOUNT_RE.test(amount)) throw new Error("importe no válido");
  const [int, frac = ""] = amount.split(".");
  return BigInt(int) * 10_000_000n + BigInt(frac.padEnd(7, "0"));
}
