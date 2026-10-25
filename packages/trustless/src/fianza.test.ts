import { describe, expect, it } from "vitest";

import {
  buildDeployBody,
  buildResolveBody,
  buildStopBody,
  fianzaStatus,
  FianzaError,
  planApproveRelease,
  validateParties,
} from "./fianza";
import {
  ADMIN,
  escrowFixture,
  ESCROW_ID,
  LANDLORD,
  parties,
  STAFF,
  TENANT,
  TREASURY,
  USDC,
  VAULT,
} from "./test-utils";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as FianzaError).code;
  }
  return "OK";
};

describe("buildDeployBody", () => {
  it("mapea la fianza a un escrow v2 con quórum de 2", () => {
    const body = buildDeployBody({
      fianzaId: 7,
      parties,
      amount: 5_000_000_000n,
      asset: { contractId: USDC },
    });

    expect(body).toEqual({
      signer: TENANT,
      engagementId: "fianza-7",
      title: "Fianza 7",
      description: "Fianza de habitación",
      roles: {
        approvers: [LANDLORD, TENANT],
        serviceProviders: [LANDLORD],
        platform: TREASURY,
        releaseSigners: [LANDLORD, TENANT],
        disputeResolvers: [STAFF],
        receiver: TENANT,
        admin: ADMIN,
        observers: [],
      },
      amount: 500,
      platformFee: 0,
      milestones: [{ description: "Devolución de la fianza", approvalsTarget: 2 }],
      trustline: { contractId: USDC },
    });
    expect("defindex" in body).toBe(false);
  });

  it("añade DeFindex solo si se pide", () => {
    const body = buildDeployBody({
      fianzaId: 1,
      parties,
      amount: 1n,
      asset: { contractId: USDC },
      defindex: { vault: VAULT, platformYieldFeeBps: 2_000, tenantYieldBps: 0 },
    });
    expect(body).toMatchObject({ defindex: { vaultContractId: VAULT } });
  });

  it("rechaza importes no positivos", () => {
    expect(code(() => buildDeployBody({ fianzaId: 1, parties, amount: 0n, asset: {} }))).toBe(
      "INVALID_AMOUNT",
    );
  });
});

describe("validateParties", () => {
  it.each([
    ["casero = inquilino", { tenant: LANDLORD }],
    ["staff vacío", { staff: [] }],
    ["más de 5 staff", { staff: ["1", "2", "3", "4", "5", "6"] }],
    ["staff repetido", { staff: [STAFF, STAFF] }],
    ["staff = casero", { staff: [LANDLORD] }],
    ["staff = inquilino", { staff: [TENANT] }],
    ["staff = tesorería", { staff: [TREASURY] }],
    ["admin = casero", { admin: LANDLORD }],
    ["admin = staff", { admin: STAFF }],
    ["admin = tesorería", { admin: TREASURY }],
  ])("rechaza %s", (_name, change) => {
    expect(code(() => validateParties({ ...parties, ...change }))).toBe("INVALID_PARTIES");
  });

  it("acepta un reparto válido", () => {
    expect(code(() => validateParties(parties))).toBe("OK");
  });
});

describe("fianzaStatus", () => {
  it("deriva el estado del escrow de TW", () => {
    expect(fianzaStatus(escrowFixture({ balance: 0 }))).toBe("Proposed");
    expect(fianzaStatus(escrowFixture())).toBe("Active");
    expect(
      fianzaStatus(escrowFixture({ dispute: { isDisputed: true, reason: "h", resolved: false } })),
    ).toBe("Stopped");
    expect(fianzaStatus(escrowFixture({ released: true }))).toBe("Settled");
    expect(
      fianzaStatus(escrowFixture({ dispute: { isDisputed: true, reason: "h", resolved: true } })),
    ).toBe("Settled");
  });
});

describe("planApproveRelease", () => {
  it("la primera aprobación solo aprueba", () => {
    const action = planApproveRelease(escrowFixture(), LANDLORD);
    expect(action).toEqual({
      kind: "approve",
      body: { contractId: ESCROW_ID, approver: LANDLORD, milestoneIndexes: [0] },
    });
  });

  it("la segunda aprueba y libera, en cualquier orden", () => {
    for (const [first, second] of [
      [LANDLORD, TENANT],
      [TENANT, LANDLORD],
    ]) {
      const escrow = escrowFixture();
      escrow.milestones[0].approvals = { target: 2, approvalCount: 1, approvedBy: [first] };
      expect(planApproveRelease(escrow, second)).toEqual({
        kind: "approve-and-release",
        body: { contractId: ESCROW_ID, signer: second, milestoneIndexes: [0] },
      });
    }
  });

  it("rechaza estados y partes incorrectos", () => {
    const approved = escrowFixture();
    approved.milestones[0].approvals = { target: 2, approvalCount: 1, approvedBy: [TENANT] };
    expect(code(() => planApproveRelease(approved, TENANT))).toBe("ALREADY_APPROVED");
    expect(code(() => planApproveRelease(escrowFixture(), STAFF))).toBe("NOT_PARTY");
    expect(code(() => planApproveRelease(escrowFixture({ balance: 0 }), TENANT))).toBe("NOT_FUNDED");
    expect(code(() => planApproveRelease(escrowFixture({ released: true }), TENANT))).toBe(
      "ALREADY_SETTLED",
    );
    const stopped = escrowFixture({ dispute: { isDisputed: true, reason: "h", resolved: false } });
    expect(code(() => planApproveRelease(stopped, TENANT))).toBe("DISPUTED");
  });
});

describe("parar y resolver", () => {
  const stopped = () =>
    escrowFixture({ dispute: { isDisputed: true, reason: "hash", resolved: false } });

  it("solo el casero para una fianza activa", () => {
    expect(buildStopBody(escrowFixture(), LANDLORD, "hash")).toEqual({
      contractId: ESCROW_ID,
      signer: LANDLORD,
      reason: "hash",
    });
    expect(code(() => buildStopBody(escrowFixture(), TENANT, "hash"))).toBe("NOT_PARTY");
    expect(code(() => buildStopBody(escrowFixture({ balance: 0 }), LANDLORD, "hash"))).toBe(
      "NOT_FUNDED",
    );
    expect(code(() => buildStopBody(escrowFixture(), LANDLORD, "x".repeat(501)))).toBe(
      "INVALID_REASON",
    );
  });

  it("la deducción va al casero y el resto al inquilino, sumando el saldo", () => {
    const body = buildResolveBody(stopped(), STAFF, 1_000_000_000n); // 100 de 500
    expect(body).toEqual({
      contractId: ESCROW_ID,
      disputeResolver: STAFF,
      distributions: [
        { address: TENANT, amount: 400 },
        { address: LANDLORD, amount: 100 },
      ],
    });
  });

  it("sin deducción todo vuelve al inquilino (sin transferencias de 0)", () => {
    expect(buildResolveBody(stopped(), STAFF, 0n).distributions).toEqual([
      { address: TENANT, amount: 500 },
    ]);
  });

  it("valida resolver, estado y deducción", () => {
    expect(code(() => buildResolveBody(stopped(), LANDLORD, 0n))).toBe("NOT_RESOLVER");
    expect(code(() => buildResolveBody(escrowFixture(), STAFF, 0n))).toBe("NOT_DISPUTED");
    expect(code(() => buildResolveBody(stopped(), STAFF, -1n))).toBe("INVALID_AMOUNT");
    expect(code(() => buildResolveBody(stopped(), STAFF, 5_000_000_001n))).toBe("INVALID_AMOUNT");
  });
});
