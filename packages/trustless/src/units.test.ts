import { describe, expect, it } from "vitest";

import { fromDecimal, toDecimal } from "./units";

describe("units", () => {
  it("convierte unidad mínima a decimales y vuelta, sin perder precisión", () => {
    for (const units of [0n, 1n, 5_000_000_000n, 1_234_567_891n, 90_071_992_547_409n]) {
      expect(fromDecimal(toDecimal(units))).toBe(units);
    }
    expect(toDecimal(5_000_000_000n)).toBe(500);
    expect(toDecimal(1n)).toBe(0.0000001);
    expect(toDecimal(1_005_000_000n)).toBe(100.5);
  });

  it("acepta decimales en texto o número", () => {
    expect(fromDecimal("100.5")).toBe(1_005_000_000n);
    expect(fromDecimal(100.5)).toBe(1_005_000_000n);
    expect(fromDecimal("0.0000001")).toBe(1n);
    expect(fromDecimal(1e-7)).toBe(1n);
  });

  it("rechaza importes que no se pueden representar", () => {
    expect(() => fromDecimal("-1")).toThrow(RangeError);
    expect(() => fromDecimal("1.00000001")).toThrow(RangeError);
    expect(() => fromDecimal("abc")).toThrow(RangeError);
    expect(() => fromDecimal(Number.NaN)).toThrow(RangeError);
    expect(() => toDecimal(-1n)).toThrow(RangeError);
    expect(() => toDecimal(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
  });
});
