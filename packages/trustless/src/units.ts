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

/**
 * Saldo que devuelve la API → unidad mínima, **truncando** lo que pase de 7 decimales (un `number`
 * puede traer restos de coma flotante). Truncar garantiza no repartir nunca más de lo que hay.
 */
export function floorToUnits(value: number | string): bigint {
  const text = typeof value === "number" ? numberToPlain(value) : value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new RangeError(`Importe no válido: ${value}`);
  const [, whole, fraction = ""] = match;
  return fromDecimal(fraction ? `${whole}.${fraction.slice(0, DECIMALS)}` : whole);
}

function numberToPlain(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Importe no válido: ${value}`);
  // toString da la representación decimal más corta que vuelve al mismo número, pero por debajo
  // de 1e-6 usa notación exponencial ("9.6e-7"). Se pasa a decimal desde el propio texto, sin
  // redondear (toFixed redondearía hacia arriba). Negativos y exponentes positivos quedan tal
  // cual y los rechaza el regex de quien llama.
  const text = value.toString();
  const exp = /^(\d)(?:\.(\d+))?e-(\d+)$/.exec(text);
  if (!exp) return text;
  const [, digit, rest = "", zeros] = exp;
  return `0.${"0".repeat(Number(zeros) - 1)}${digit}${rest}`;
}
