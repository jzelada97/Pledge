import { describe, expect, it } from "vitest";
import { isValidAmount, toStroops } from "./amount";

describe("importes", () => {
  it("convierte a stroops con aritmética entera", () => {
    expect(toStroops("1")).toBe(10_000_000n);
    expect(toStroops("12.5")).toBe(125_000_000n);
    expect(toStroops("0.0000001")).toBe(1n);
    expect(toStroops("999999.9999999")).toBe(9_999_999_999_999n);
  });

  it("rechaza formatos peligrosos", () => {
    for (const a of ["1e3", "-1", "0", "0.00000001", "1.", ".5", "1000000", " 1", "0x10", ""]) {
      expect(isValidAmount(a), a).toBe(false);
    }
  });
});
