import { Address, nativeToScVal } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { verifyAuthTree } from "./auth-check";
import { WalletError } from "./errors";
import { call, entry, hostFn, invoke, randomContract, terms, transfer } from "./test-utils";
import type { ContractsConfig } from "./types";

const factory = randomContract();
const token = randomContract();
const escrow = randomContract();
const tenant = randomContract();
const landlord = randomContract();
const cfg: ContractsConfig = { factory, token, isRegisteredEscrow: async (a) => a === escrow };

const AMOUNT = 11_600_000_000n;
// Lo que el usuario ha visto en pantalla antes de fondear.
const seen = { expectedTransferAmount: AMOUNT };

function fundCall(amount = AMOUNT) {
  return invoke(escrow, "fund_escrow", [new Address(tenant).toScVal(), terms(amount), terms(amount)]);
}

async function expectMismatch(p: Promise<unknown>) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof WalletError && e.code === "AUTH_MISMATCH");
}

describe("verifyAuthTree", () => {
  it("acepta fund_escrow con su única transferencia exacta", async () => {
    const args = fundCall();
    const auth = [entry(tenant, call(args, [transfer(token, tenant, escrow, AMOUNT)]))];
    await expect(verifyAuthTree({ func: hostFn(args), auth }, tenant, cfg, seen)).resolves.toBe(auth[0]);
    await expectMismatch(verifyAuthTree({ func: hostFn(args), auth }, tenant, cfg));
    await expectMismatch(verifyAuthTree({ func: hostFn(args), auth }, tenant, cfg, { expectedTransferAmount: AMOUNT + 1n }));
  });

  it("rechaza una transferencia de más importe, a otro destino o una subinvocación extra", async () => {
    const args = fundCall();
    for (const subs of [
      [transfer(token, tenant, escrow, AMOUNT + 1n)],
      [transfer(token, tenant, randomContract(), AMOUNT)],
      [transfer(token, tenant, escrow, AMOUNT), transfer(token, tenant, randomContract(), 1n)],
      [transfer(randomContract(), tenant, escrow, AMOUNT)],
      [],
    ]) {
      await expectMismatch(verifyAuthTree({ func: hostFn(args), auth: [entry(tenant, call(args, subs))] }, tenant, cfg, seen));
    }
  });

  it("rechaza escrows no registrados y funciones de staff", async () => {
    const fake = invoke(randomContract(), "approve_release", [new Address(tenant).toScVal()]);
    await expectMismatch(verifyAuthTree({ func: hostFn(fake), auth: [entry(tenant, call(fake))] }, tenant, cfg));
    const resolve = invoke(escrow, "resolve", []);
    await expectMismatch(verifyAuthTree({ func: hostFn(resolve), auth: [entry(tenant, call(resolve))] }, tenant, cfg));
  });

  it("rechaza una raíz distinta de la llamada y credenciales de cuenta origen", async () => {
    const args = invoke(escrow, "approve_release", [new Address(tenant).toScVal()]);
    const other = invoke(escrow, "approve_release", [new Address(landlord).toScVal()]);
    await expectMismatch(verifyAuthTree({ func: hostFn(args), auth: [entry(tenant, call(other))] }, tenant, cfg));
    await expectMismatch(verifyAuthTree({ func: hostFn(args), auth: [entry(tenant, call(args), "source")] }, tenant, cfg));
  });

  it("stop exige el importe del bond y una única transferencia de ese importe", async () => {
    const args = invoke(escrow, "stop", []);
    const bond = 100_000_000n;
    const auth = [entry(landlord, call(args, [transfer(token, landlord, escrow, bond)]))];
    await expectMismatch(verifyAuthTree({ func: hostFn(args), auth }, landlord, cfg));
    await expect(verifyAuthTree({ func: hostFn(args), auth }, landlord, cfg, { expectedTransferAmount: bond })).resolves.toBe(auth[0]);
    await expectMismatch(verifyAuthTree({ func: hostFn(args), auth }, landlord, cfg, { expectedTransferAmount: bond + 1n }));
  });

  describe("escrows de Trustless Work (plan A)", () => {
    const tw = randomContract();
    const feeAddress = randomContract();
    const twCfg: ContractsConfig = { ...cfg, trustless: { isEscrow: async (a) => a === tw, feeAddress } };
    const twFund = (amount: bigint) =>
      invoke(tw, "fund_escrow", [new Address(tenant).toScVal(), terms(1n), nativeToScVal(amount, { type: "i128" })]);

    it("acepta fund_escrow con la transferencia exacta del tercer argumento", async () => {
      const args = twFund(AMOUNT);
      const auth = [entry(tenant, call(args, [transfer(token, tenant, tw, AMOUNT)]))];
      await expect(verifyAuthTree({ func: hostFn(args), auth }, tenant, twCfg, seen)).resolves.toBe(auth[0]);
      await expectMismatch(
        verifyAuthTree({ func: hostFn(args), auth: [entry(tenant, call(args, [transfer(token, tenant, tw, AMOUNT + 1n)]))] }, tenant, twCfg, seen),
      );
    });

    it("fund_escrow exige el importe que ve el usuario y, si llega, el escrow esperado", async () => {
      const args = twFund(AMOUNT);
      const auth = [entry(tenant, call(args, [transfer(token, tenant, tw, AMOUNT)]))];
      const inv = { func: hostFn(args), auth };
      await expectMismatch(verifyAuthTree(inv, tenant, twCfg));
      await expectMismatch(verifyAuthTree(inv, tenant, twCfg, { expectedTransferAmount: AMOUNT - 1n }));
      await expectMismatch(verifyAuthTree(inv, tenant, twCfg, { expectedTransferAmount: AMOUNT, expectedContract: randomContract() }));
      await expect(verifyAuthTree(inv, tenant, twCfg, { expectedTransferAmount: AMOUNT, expectedContract: tw })).resolves.toBe(auth[0]);
    });

    it("release_funds solo con la dirección de comisión configurada", async () => {
      const ok = invoke(tw, "release_funds", [new Address(tenant).toScVal(), new Address(feeAddress).toScVal()]);
      await expect(verifyAuthTree({ func: hostFn(ok), auth: [entry(tenant, call(ok))] }, tenant, twCfg)).resolves.toBeTruthy();
      const evil = invoke(tw, "release_funds", [new Address(tenant).toScVal(), new Address(randomContract()).toScVal()]);
      await expectMismatch(verifyAuthTree({ func: hostFn(evil), auth: [entry(tenant, call(evil))] }, tenant, twCfg));
    });

    it("rechaza escrows de TW no reconocidos, funciones de staff y TW sin configurar", async () => {
      const resolve = invoke(tw, "resolve_dispute", []);
      await expectMismatch(verifyAuthTree({ func: hostFn(resolve), auth: [entry(tenant, call(resolve))] }, tenant, twCfg));
      const other = invoke(randomContract(), "approve_milestone", []);
      await expectMismatch(verifyAuthTree({ func: hostFn(other), auth: [entry(tenant, call(other))] }, tenant, twCfg));
      const approve = invoke(tw, "approve_milestone", []);
      await expect(verifyAuthTree({ func: hostFn(approve), auth: [entry(tenant, call(approve))] }, tenant, twCfg)).resolves.toBeTruthy();
      await expectMismatch(verifyAuthTree({ func: hostFn(approve), auth: [entry(tenant, call(approve))] }, tenant, cfg));
    });
  });

  it("los claims no necesitan firma y create_fianza no admite subinvocaciones", async () => {
    const claim = invoke(escrow, "claim_after_timeout", []);
    await expect(verifyAuthTree({ func: hostFn(claim), auth: [] }, tenant, cfg)).resolves.toBeNull();
    const create = invoke(factory, "create_fianza", [new Address(landlord).toScVal()]);
    await expect(
      verifyAuthTree({ func: hostFn(create), auth: [entry(landlord, call(create), "v1")] }, landlord, cfg),
    ).resolves.toBeTruthy();
    await expectMismatch(
      verifyAuthTree(
        { func: hostFn(create), auth: [entry(landlord, call(create, [transfer(token, landlord, escrow, 1n)]))] },
        landlord,
        cfg,
      ),
    );
  });
});
