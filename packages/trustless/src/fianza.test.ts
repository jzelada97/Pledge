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

  it("solo el casero para, y solo una fianza activa que aún no ha aprobado", () => {
    expect(buildStopBody(escrowFixture(), LANDLORD)).toEqual({ contractId: ESCROW_ID, signer: LANDLORD });
    expect(code(() => buildStopBody(escrowFixture(), TENANT))).toBe("NOT_PARTY");
    expect(code(() => buildStopBody(escrowFixture({ balance: 0 }), LANDLORD))).toBe("NOT_FUNDED");
    expect(code(() => buildStopBody(stopped, LANDLORD))).toBe("DISPUTED");
    expect(
      code(() => buildStopBody(escrowFixture({ flags: { disputed: false, released: true, resolved: false } }), LANDLORD)),
    ).toBe("ALREADY_SETTLED");
    // Si ya aprobó la devolución no puede echarse atrás.
    expect(code(() => buildStopBody(escrowFixture({ milestones: approvedMilestone }), LANDLORD))).toBe("ALREADY_APPROVED");
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

  // Si el vault perdió valor, repartir lo fondeado superaría el saldo y la resolución fallaría en
  // cadena, dejando la fianza bloqueada: se reparte lo que queda y la pérdida la absorbe el inquilino.
  it("con pérdida en el vault reparte el saldo disponible, nunca más", () => {
    const lost = { ...stopped, balance: 450 }; // fondeado 500, el vault perdió 50
    expect(buildResolveBody(lost, STAFF, 1_000_000_000n).distributions).toEqual([
      { address: TENANT, amount: 350 },
      { address: LANDLORD, amount: 100 },
    ]);
    expect(buildResolveBody(lost, STAFF, 0n).distributions).toEqual([{ address: TENANT, amount: 450 }]);
    // Si la deducción supera lo que queda, el casero se lleva el saldo; nunca más que la fianza.
    expect(buildResolveBody(lost, STAFF, 4_800_000_000n).distributions).toEqual([{ address: LANDLORD, amount: 450 }]);
    expect(code(() => buildResolveBody(lost, STAFF, 5_000_000_001n))).toBe("INVALID_AMOUNT");
    // Saldo con restos de coma flotante: se trunca a 7 decimales y se reparte como mucho eso.
    const noisy = { ...stopped, balance: 449.99999999999994 };
    expect(buildResolveBody(noisy, STAFF, 0n).distributions).toEqual([{ address: TENANT, amount: 449.9999999 }]);
  });

  it("deducir el 100 % funciona aunque el vault redondee 1 stroop a la baja", () => {
    const rounded = { ...stopped, balance: 499.9999999 };
    expect(buildResolveBody(rounded, STAFF, 5_000_000_000n).distributions).toEqual([{ address: LANDLORD, amount: 499.9999999 }]);
  });

  it("sin saldo no hay nada que repartir", () => {
    expect(code(() => buildResolveBody({ ...stopped, balance: 0 }, STAFF, 0n))).toBe("INVALID_AMOUNT");
  });

  it("el rendimiento sobrante se reparte según la jurisdicción, con la fianza ya liquidada", () => {
    const resolved = escrowFixture({ flags: { disputed: true, released: false, resolved: true } });
    expect(buildWithdrawYieldBody(resolved, STAFF, 893n, 5000).distributions).toEqual([
      { address: TENANT, amount: 0.0000446 },
      { address: LANDLORD, amount: 0.0000447 },
    ]);
    expect(buildWithdrawYieldBody(resolved, STAFF, 893n, 0).distributions).toEqual([{ address: LANDLORD, amount: 0.0000893 }]);
    const released = escrowFixture({ flags: { disputed: false, released: true, resolved: false } });
    expect(buildWithdrawYieldBody(released, STAFF, 893n, 0).distributions).toEqual([{ address: LANDLORD, amount: 0.0000893 }]);
    expect(() => buildWithdrawYieldBody(resolved, STAFF, 1n, 10_001)).toThrow(RangeError);
    expect(code(() => buildWithdrawYieldBody(resolved, TENANT, 1n, 0))).toBe("NOT_RESOLVER");
    expect(code(() => buildWithdrawYieldBody(stopped, STAFF, 1n, 0))).toBe("NOT_SETTLED");
    expect(code(() => buildWithdrawYieldBody(resolved, STAFF, 0n, 0))).toBe("INVALID_AMOUNT");
  });

  it("la comisión de plataforma sobre el rendimiento es opcional y sale antes de la jurisdicción", () => {
    const resolved = escrowFixture({ flags: { disputed: true, released: false, resolved: true } });
    // Sin comisión (por defecto) la tesorería no aparece.
    expect(buildWithdrawYieldBody(resolved, STAFF, 1000n, 0).distributions).toEqual([{ address: LANDLORD, amount: 0.0001 }]);
    // 20 % a la tesorería y, del resto, la mitad al inquilino.
    expect(buildWithdrawYieldBody(resolved, STAFF, 1000n, 5000, 2000).distributions).toEqual([
      { address: TREASURY, amount: 0.00002 },
      { address: TENANT, amount: 0.00004 },
      { address: LANDLORD, amount: 0.00004 },
    ]);
    // Con todo el sobrante para la tesorería no quedan distribuciones vacías.
    expect(buildWithdrawYieldBody(resolved, STAFF, 1000n, 5000, 10_000).distributions).toEqual([{ address: TREASURY, amount: 0.0001 }]);
    expect(() => buildWithdrawYieldBody(resolved, STAFF, 1n, 0, 10_001)).toThrow(RangeError);
    // Los controles de #72 siguen valiendo con comisión.
    expect(code(() => buildWithdrawYieldBody(stopped, STAFF, 1000n, 0, 2000))).toBe("NOT_SETTLED");
  });
});

describe("isContractAddress", () => {
  it("distingue passkeys (C…) de cuentas clásicas (G…)", () => {
    expect(isContractAddress(TENANT)).toBe(true);
    expect(isContractAddress(LANDLORD)).toBe(false);
    // Solo el formato StrKey completo: C + 55 caracteres base32.
    expect(isContractAddress("C")).toBe(false);
    expect(isContractAddress(`${TENANT}B`)).toBe(false);
    expect(isContractAddress(TENANT.toLowerCase())).toBe(false);
    expect(isContractAddress("CALLE MAYOR 1")).toBe(false);
    expect(isContractAddress(TENANT.slice(0, 55) + "1")).toBe(false); // 1 no es base32
  });
});
