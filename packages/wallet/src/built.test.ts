import { Address, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { sendBuilt, type BuiltDeps } from "./built";
import { WalletError } from "./errors";
import { call, entry, hostFn, invoke, randomContract, terms, transfer } from "./test-utils";
import type { UnsignedTransactionResponse } from "./types";

const factory = randomContract();
const token = randomContract();
const escrow = randomContract();
const tenant = randomContract();
const LATEST = 1000;

function deps(over: Partial<BuiltDeps> = {}) {
  const signAuthEntry = vi.fn(async (e: xdr.SorobanAuthorizationEntry, _exp: number) => e);
  const fetchMock = vi.fn(async (_p: string, _i?: RequestInit) =>
    Response.json({ success: true, data: { transactionId: "t", hash: "h1", status: "confirmed" } }),
  );
  const d: BuiltDeps = {
    signer: tenant,
    cfg: { factory, token, isRegisteredEscrow: async (a) => a === escrow, relayPath: "/api/fianzas/v1/relay" },
    latestLedger: async () => LATEST,
    signAuthEntry,
    fetch: fetchMock as unknown as typeof fetch,
    ...over,
  };
  return { d, signAuthEntry, fetchMock };
}

function fundBuild(validUntilLedger = LATEST + 60, subs?: xdr.SorobanAuthorizedInvocation[]): UnsignedTransactionResponse {
  const args = invoke(escrow, "fund_escrow", [new Address(tenant).toScVal(), terms(5n), terms(5n)]);
  const auth = [entry(tenant, call(args, subs ?? [transfer(token, tenant, escrow, 5n)]))];
  return {
    unsignedXdr: "informativo",
    txHash: "x",
    soroban: { func: hostFn(args).toXDR("base64"), auth: auth.map((a) => a.toXDR("base64")), validUntilLedger },
  };
}

describe("sendBuilt", () => {
  it("verifica, firma la entrada del firmante con la expiración acotada y la envía por el relay", async () => {
    const { d, signAuthEntry, fetchMock } = deps();
    const phases: string[] = [];
    const build = fundBuild(LATEST + 500); // la API propone más de 60: se acota
    await expect(sendBuilt(build, d, { onPhase: (p) => phases.push(p) })).resolves.toEqual({ hash: "h1" });
    expect(signAuthEntry).toHaveBeenCalledTimes(1);
    expect(signAuthEntry.mock.calls[0][1]).toBe(LATEST + 60);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/fianzas/v1/relay");
    expect(JSON.parse(init!.body as string).func).toBe(build.soroban!.func);
    expect(phases).toEqual(["verifying", "signing", "submitting"]);
  });

  it("no firma ni envía un build que no supera WEB-3", async () => {
    const { d, signAuthEntry, fetchMock } = deps();
    const evil = fundBuild(LATEST + 60, [transfer(token, tenant, randomContract(), 5n)]);
    await expect(sendBuilt(evil, d)).rejects.toMatchObject({ code: "AUTH_MISMATCH" });
    expect(signAuthEntry).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rechaza builds caducados", async () => {
    const { d } = deps();
    await expect(sendBuilt(fundBuild(LATEST), d)).rejects.toMatchObject({ code: "TX_FAILED" });
  });

  it("traduce los errores del relay", async () => {
    for (const [status, code, expected] of [
      [429, "RATE_LIMITED", "RATE_LIMITED"],
      [400, "SIMULATION_FAILED", "SIMULATION_FAILED"],
      [403, "NOT_ALLOWED", "AUTH_MISMATCH"],
      [503, "RELAYER_DOWN", "RELAYER_DOWN"],
      [502, "TX_FAILED", "TX_FAILED"],
    ] as const) {
      const { d } = deps({ fetch: (async () => Response.json({ success: false, code }, { status })) as unknown as typeof fetch });
      await expect(sendBuilt(fundBuild(), d)).rejects.toSatisfy((e: unknown) => e instanceof WalletError && e.code === expected);
    }
  });

  it("sin `soroban` firma el XDR fuera y lo envía con send-transaction", async () => {
    const fetchMock = vi.fn(async (_p: string, _i?: RequestInit) => Response.json({ txHash: "g1", ledger: 5, code: "STELLAR_TX_SUBMITTED" }));
    const { d } = deps({ fetch: fetchMock as unknown as typeof fetch });
    const build: UnsignedTransactionResponse = { unsignedXdr: "AAAA", txHash: "g1" };
    await expect(sendBuilt(build, d)).rejects.toMatchObject({ code: "NOT_CONNECTED" });
    const signXdr = vi.fn(async (x: string) => `${x}-firmado`);
    await expect(sendBuilt(build, d, { signXdr })).resolves.toEqual({ hash: "g1" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/stellar/send-transaction");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ signedXdr: "AAAA-firmado" });
  });
});
