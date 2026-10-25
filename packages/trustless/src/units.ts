// Conversión exacta entre la unidad mínima del token (7 decimales, `bigint`) y los decimales
// que usa la API de Trustless Work. Nunca se hacen cuentas con `number`: solo se convierte al
// final, a partir de la representación en texto.

export const DECIMALS = 7;
const SCALE = 10n ** BigInt(DECIMALS);
const DECIMAL_RE = /^(\d+)(?:\.(\d{1,7}))?$/;

/** 5_000_000_000n → 500. Lanza si el importe no cabe sin perder precisión en `number`. */
export function toDecimal(units: bigint): number {
  if (units < 0n) throw new RangeError("Importe negativo");
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Importe demasiado grande para la API de Trustless Work");
  }
  const whole = units / SCALE;
  const fraction = (units % SCALE).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return Number(fraction ? `${whole}.${fraction}` : `${whole}`);
}

/** 500 o "500.25" → unidad mínima. Rechaza negativos y más de 7 decimales. */
export function fromDecimal(value: number | string): bigint {
  const text = typeof value === "number" ? numberToPlain(value) : value.trim();
  const match = DECIMAL_RE.exec(text);
  if (!match) throw new RangeError(`Importe no válido: ${value}`);
  const [, whole, fraction = ""] = match;
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(DECIMALS, "0"));
}

function numberToPlain(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Importe no válido: ${value}`);
  // toString da la representación decimal más corta que vuelve al mismo número; con
  // importes de 7 decimales no usa notación exponencial salvo valores minúsculos.
  const text = value.toString();
  if (!/e/i.test(text)) return text;
  return value.toFixed(DECIMALS);
}
