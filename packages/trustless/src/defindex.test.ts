import { describe, expect, it } from "vitest";

import { accruedYield, withDefindex } from "./defindex";
import { buildDeployBody } from "./fianza";
import { escrowFixture, parties, USDC, VAULT } from "./test-utils";

const base = () =>
  buildDeployBody({ fianzaId: 1, parties, amount: 5_000_000_000n, asset: { contractId: USDC } });

describe("withDefindex (supuesto)", () => {
  it("MVP Portugal: 20 % a la plataforma y el resto del rendimiento al casero", () => {
    const body = withDefindex(base(), { vault: VAULT, platformYieldFeeBps: 2_000, tenantYieldBps: 0 });
    expect(body.defindex).toEqual({
      vaultContractId: VAULT,
      yieldDistribution: { platformBps: 2_000, receiverBps: 0, serviceProviderBps: 8_000 },
    });
  });

  it("el reparto suma siempre 10000 bps", () => {
    for (const fee of [0, 1_500, 2_000, 10_000]) {
      for (const tenant of [0, 3_333, 5_000, 10_000]) {
        const d = withDefindex(base(), { vault: VAULT, platformYieldFeeBps: fee, tenantYieldBps: tenant })
          .defindex.yieldDistribution;
        expect(d.platformBps + d.receiverBps + d.serviceProviderBps).toBe(10_000);
      }
    }
  });

  it("rechaza bps fuera de rango y vaults mal formados", () => {
    expect(() => withDefindex(base(), { vault: VAULT, platformYieldFeeBps: 10_001, tenantYieldBps: 0 })).toThrow();
    expect(() => withDefindex(base(), { vault: VAULT, platformYieldFeeBps: 0, tenantYieldBps: -1 })).toThrow();
    expect(() => withDefindex(base(), { vault: "GNOTACONTRACT", platformYieldFeeBps: 0, tenantYieldBps: 0 })).toThrow();
  });
});

describe("accruedYield (supuesto)", () => {
  it("es null mientras TW no lo devuelva", () => {
    expect(accruedYield(escrowFixture())).toBeNull();
  });

  it("lee el rendimiento acumulado en unidad mínima", () => {
    const escrow = { ...escrowFixture(), defindex: { vaultContractId: VAULT, accruedYield: 12.5 } };
    expect(accruedYield(escrow)).toBe(125_000_000n);
  });
});
