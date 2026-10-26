import { describe, expect, it } from "vitest";

import {
  accruedYield,
  expectedPayout,
  TW_DEPLOYER_TESTNET,
  TW_ESCROW_WASM_TESTNET,
  TW_FEE_ADDRESS_TESTNET,
  TW_VAULT_TESTNET,
} from "./defindex";
import { isContractAddress } from "./fianza";

describe("constantes de TW en testnet", () => {
  it("tienen el formato que toca (un error al copiarlas rompería la verificación sin avisar)", () => {
    expect(isContractAddress(TW_VAULT_TESTNET)).toBe(true);
    expect(isContractAddress(TW_DEPLOYER_TESTNET)).toBe(true);
    expect(TW_FEE_ADDRESS_TESTNET).toMatch(/^G[A-Z2-7]{55}$/);
    expect(TW_ESCROW_WASM_TESTNET).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("rendimiento en el vault", () => {
  it("rendimiento = valor en el vault − lo fondeado, nunca negativo", () => {
    const funded = 20_000_000_0n; // 20 USDC
    expect(accruedYield({ vault: TW_VAULT_TESTNET, shares: 19.9996115, underlying: 20.0000023 }, funded)).toBe(23n);
    // Justo después de fondear, el redondeo del vault deja 1 stroop por debajo.
    expect(accruedYield({ vault: TW_VAULT_TESTNET, shares: 9.999728, underlying: 9.9999999 }, 100_000_000n)).toBe(0n);
    // La valoración de shares puede traer más de 7 decimales: se trunca en vez de lanzar.
    expect(accruedYield({ vault: TW_VAULT_TESTNET, shares: 1, underlying: 500.00008931 }, 5_000_000_000n)).toBe(893n);
  });

  it("el cobro esperado descuenta el 0,3 % de TW y el platformFee sobre todo lo retirado", () => {
    // Ejemplo de la guía de TW: 500,0000893 con un 1 % → 493,5000883.
    expect(expectedPayout(5_000_000_893n, 1)).toBe(4_935_000_883n);
    // Ciclo real en testnet (#62): 10,0000008 sin platformFee → 9,9700008.
    expect(expectedPayout(100_000_008n, 0)).toBe(99_700_008n);
    expect(() => expectedPayout(1n, 100)).toThrow(RangeError);
  });
});
