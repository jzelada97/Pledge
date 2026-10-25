import { describe, expect, it } from "vitest";

import {
  buildDeployBody,
  buildResolveBody,
  buildStopBody,
  buildWithdrawYieldBody,
  fianzaStatus,
  FianzaError,
  isContractAddress,
  planApproveRelease,
  validateParties,
} from "./fianza";
import { escrowFixture, ESCROW_ID, ISSUER, LANDLORD, parties, STAFF, TENANT, TREASURY } from "./test-utils";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as FianzaError).code;
  }
  return "OK";
};

const approvedMilestone = [{ description: "Devolución de la fianza", status: "pending", evidence: "", approved: true }];

describe("buildDeployBody", () => {
  it("mapea la fianza a roles v1: casero aprueba, inquilino libera y cobra", () => {
    const body = buildDeployBody({ fianzaId: 7, parties, amount: 5_000_000_000n, assetIssuer: ISSUER });
    expect(body).toEqual({
      signer: TREASURY,
      engagementId: "fianza-7",
      title: "Fianza 7",
      description: "Fianza de habitación",
      roles: {
        approver: LANDLORD,
        serviceProvider: LANDLORD,
        platformAddress: TREASURY,
        releaseSigner: TENANT,
        disputeResolver: STAFF,
        receiver: TENANT,
      },
      amount: 500,
      platformFee: 0,
      milestones: [{ description: "Devolución de la fianza" }],
      trustline: { symbol: "USDC", address: ISSUER },
    });
  });

  it("solo manda `vault` si se pide uno", () => {
    const vault = "CVAULT".padEnd(56, "V");
    expect(buildDeployBody({ fianzaId: 1, parties, amount: 1n, assetIssuer: ISSUER, vault }).vault).toBe(vault);
  });

  it("rechaza importes y roles no válidos", () => {
    expect(code(() => buildDeployBody({ fianzaId: 1, parties, amount: 0n, assetIssuer: ISSUER }))).toBe("INVALID_AMOUNT");
    expect(code(() => validateParties({ ...parties, tenant: LANDLORD }))).toBe("INVALID_PARTIES");
    expect(code(() => validateParties({ ...parties, staff: LANDLORD }))).toBe("INVALID_PARTIES");
    expect(code(() => validateParties({ ...parties, staff: TREASURY }))).toBe("INVALID_PARTIES");
    expect(code(() => validateParties({ ...parties, treasury: TENANT }))).toBe("INVALID_PARTIES");
  });
});

describe("fianzaStatus", () => {
  it("deriva el estado de los flags y del saldo", () => {
    expect(fianzaStatus(escrowFixture({ balance: 0 }))).toBe("Proposed");
    expect(fianzaStatus(escrowFixture({ balance: 499.9999999 }))).toBe("Active"); // redondeo del vault
    expect(fianzaStatus(escrowFixture({ flags: { disputed: true, released: false, resolved: false } }))).toBe("Stopped");
    expect(fianzaStatus(escrowFixture({ flags: { disputed: false, released: true, resolved: false } }))).toBe("Settled");
    expect(fianzaStatus(escrowFixture({ flags: { disputed: true, released: false, resolved: true } }))).toBe("Settled");
  });
});

describe("planApproveRelease", () => {
  it("primero aprueba el casero; después libera el inquilino", () => {
    expect(planApproveRelease(escrowFixture(), LANDLORD)).toEqual({
      kind: "approve",
      body: { contractId: ESCROW_ID, milestoneIndex: "0", approver: LANDLORD },
    });
    expect(code(() => planApproveRelease(escrowFixture(), TENANT))).toBe("NOT_APPROVED");
    const approved = escrowFixture({ milestones: approvedMilestone });
    expect(planApproveRelease(approved, TENANT)).toEqual({
      kind: "release",
      body: { contractId: ESCROW_ID, releaseSigner: TENANT },
    });
    expect(code(() => planApproveRelease(approved, LANDLORD))).toBe("ALREADY_APPROVED");
  });

  it("rechaza terceros y estados que no admiten aprobar", () => {
    expect(code(() => planApproveRelease(escrowFixture(), STAFF))).toBe("NOT_PARTY");
    expect(code(() => planApproveRelease(escrowFixture({ balance: 0 }), LANDLORD))).toBe("NOT_FUNDED");
    expect(
      code(() => planApproveRelease(escrowFixture({ flags: { disputed: true, released: false, resolved: false } }), LANDLORD)),
    ).toBe("DISPUTED");
    expect(
      code(() => planApproveRelease(escrowFixture({ flags: { disputed: false, released: true, resolved: false } }), TENANT)),
    ).toBe("ALREADY_SETTLED");
  });
});

describe("parar y resolver", () => {
  const stopped = escrowFixture({ flags: { disputed: true, released: false, resolved: false } });

  it("solo el casero para, y solo una fianza activa", () => {
    expect(buildStopBody(escrowFixture(), LANDLORD)).toEqual({ contractId: ESCROW_ID, signer: LANDLORD });
    expect(code(() => buildStopBody(escrowFixture(), TENANT))).toBe("NOT_PARTY");
    expect(code(() => buildStopBody(escrowFixture({ balance: 0 }), LANDLORD))).toBe("NOT_FUNDED");
  });

  it("resolver reparte el importe fondeado: deducción al casero, el resto al inquilino", () => {
    expect(buildResolveBody(stopped, STAFF, 1_000_000_000n)).toEqual({
      contractId: ESCROW_ID,
      disputeResolver: STAFF,
      distributions: [
        { address: TENANT, amount: 400 },
        { address: LANDLORD, amount: 100 },
      ],
    });
    // Sin deducción no aparece el casero (no se transfieren importes 0).
    expect(buildResolveBody(stopped, STAFF, 0n).distributions).toEqual([{ address: TENANT, amount: 500 }]);
    expect(code(() => buildResolveBody(stopped, STAFF, 5_000_000_001n))).toBe("INVALID_AMOUNT");
    expect(code(() => buildResolveBody(stopped, LANDLORD, 0n))).toBe("NOT_RESOLVER");
    expect(code(() => buildResolveBody(escrowFixture(), STAFF, 0n))).toBe("NOT_DISPUTED");
  });

  it("el rendimiento sobrante se reparte según la jurisdicción", () => {
    expect(buildWithdrawYieldBody(stopped, STAFF, 893n, 5000).distributions).toEqual([
      { address: TENANT, amount: 0.0000446 },
      { address: LANDLORD, amount: 0.0000447 },
    ]);
    expect(buildWithdrawYieldBody(stopped, STAFF, 893n, 0).distributions).toEqual([{ address: LANDLORD, amount: 0.0000893 }]);
    expect(() => buildWithdrawYieldBody(stopped, STAFF, 1n, 10_001)).toThrow(RangeError);
    expect(code(() => buildWithdrawYieldBody(stopped, TENANT, 1n, 0))).toBe("NOT_RESOLVER");
  });

  it("la comisión de plataforma sobre el rendimiento es opcional y sale antes de la jurisdicción", () => {
    // Sin comisión (por defecto) la tesorería no aparece.
    expect(buildWithdrawYieldBody(stopped, STAFF, 1000n, 0).distributions).toEqual([{ address: LANDLORD, amount: 0.0001 }]);
    // 20 % a la tesorería y, del resto, la mitad al inquilino.
    expect(buildWithdrawYieldBody(stopped, STAFF, 1000n, 5000, 2000).distributions).toEqual([
      { address: TREASURY, amount: 0.00002 },
      { address: TENANT, amount: 0.00004 },
      { address: LANDLORD, amount: 0.00004 },
    ]);
    expect(() => buildWithdrawYieldBody(stopped, STAFF, 1n, 0, 10_001)).toThrow(RangeError);
  });
});

describe("isContractAddress", () => {
  it("distingue passkeys (C…) de cuentas clásicas (G…)", () => {
    expect(isContractAddress(TENANT)).toBe(true);
    expect(isContractAddress(LANDLORD)).toBe(false);
  });

  it("exige el formato completo, no solo la C inicial", () => {
    expect(isContractAddress("C")).toBe(false);
    expect(isContractAddress("CALLE MAYOR 1")).toBe(false);
    expect(isContractAddress(TENANT.toLowerCase())).toBe(false);
    expect(isContractAddress(`${TENANT}A`)).toBe(false);
    expect(isContractAddress(TENANT.slice(0, 55) + "1")).toBe(false); // 1 no es base32
  });
});
