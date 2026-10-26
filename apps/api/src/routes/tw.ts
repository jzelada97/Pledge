// Rutas de la Core API v2 de Trustless Work (arquitectura § 6.8.1).
// - Las que no implementamos o cambian de semántica responden 501 con `extensions.replacement`,
//   para que un hook del SDK de TW nunca mueva dinero de una forma distinta a la que el integrador cree.
// - Compatibles: fund, approve-milestones, approve-and-release-milestones y extend-ttl, con la misma
//   ruta y cuerpo que TW. Las lecturas en forma TW llegan después.
import { Hono } from "hono";
import { z } from "zod";
import { Address, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import type { ApiConfig } from "../config";
import { toDecimal, type Chain, type TtlCache } from "../chain";
import { withContractErrors } from "../contract-errors";
import { escrowHelpers } from "../escrows";
import { accountAddress, amountInput, contractAddress, parseBody, utr } from "../http";
import { Problem, notImplementedYet, notSupported, validationError } from "../problem";
import { parseAmount } from "../views";

const SR = "/escrow/single-release/v2";

export const TW_NOT_SUPPORTED: Array<{ method: "post" | "put"; path: string; detail: string; replacement?: string }> = [
  { method: "post", path: `${SR}/deploy`, detail: "Roles, comisiones y token los fija la factory, no el llamante", replacement: "POST /api/fianzas/v1/fianzas" },
  { method: "post", path: `${SR}/release-funds`, detail: "No hay liberación separada: la segunda aprobación liquida", replacement: `POST /api${SR}/approve-and-release-milestones` },
  { method: "post", path: `${SR}/change-milestone-status`, detail: "La fianza no tiene estados de milestone" },
  { method: "post", path: `${SR}/dispute`, detail: "Solo el casero puede parar, deposita un bond y el motivo va como hash", replacement: "POST /api/fianzas/v1/fianzas/{contractId}/stop" },
  { method: "post", path: `${SR}/resolve-dispute`, detail: "No hay reparto libre: se resuelve con deduction y stopJustified", replacement: "POST /api/fianzas/v1/fianzas/{contractId}/resolve" },
  { method: "post", path: `${SR}/withdraw-remaining-funds`, detail: "Eliminado en el fork" },
  { method: "put", path: `${SR}/update`, detail: "Los Terms de una fianza son inmutables" },
  { method: "post", path: `${SR}/manage-milestones`, detail: "La fianza no tiene milestones editables" },
  { method: "post", path: "/graphql", detail: "Sin GraphQL en el MVP" },
];

const milestoneIndexes = z.array(z.number().int());

const fundBody = z.object({
  contractId: contractAddress,
  signer: accountAddress, // inquilino
  amount: amountInput,
  inviteCode: z.string().optional(), // [EXT] base64url de 32 bytes; nunca se registra (DAT-6)
});
const approveBody = z.object({ contractId: contractAddress, approver: accountAddress, milestoneIndexes });
const approveReleaseBody = z.object({ contractId: contractAddress, signer: accountAddress, milestoneIndexes });
const extendTtlBody = z.object({ contractId: contractAddress, admin: accountAddress, ledgersToExtend: z.number().int().optional() });

// La fianza tiene un único milestone sintético, el 0 ("Devolución de la fianza").
function checkMilestones(idx: number[]) {
  if (idx.length !== 1 || idx[0] !== 0) {
    throw new Problem(422, "ESCROW_INVALID_MILESTONE_INDEX", "La fianza tiene un único milestone: [0]", `milestoneIndexes = ${JSON.stringify(idx)}`);
  }
}

function inviteScVal(code: string | undefined): xdr.ScVal {
  if (!code) return xdr.ScVal.scvVoid();
  const bytes = Buffer.from(code, "base64url");
  if (bytes.length !== 32) throw validationError("inviteCode debe ser base64url de 32 bytes");
  return nativeToScVal(bytes, { type: "bytes" });
}

export function twRoutes(cfg: ApiConfig, chain: Chain, cache: TtlCache) {
  const r = new Hono();
  const esc = escrowHelpers(cfg, chain, cache);

  for (const e of TW_NOT_SUPPORTED) {
    r[e.method](e.path, () => {
      throw notSupported(e.detail, e.replacement);
    });
  }

  // fund_escrow(tenant, invite_code, expected_terms): los Terms se leen de la cadena y se reenvían
  // tal cual (sin decodificar y volver a codificar), así lo que firma el inquilino es lo que hay.
  r.post(`${SR}/fund`, async (c) => {
    const b = await parseBody(c, fundBody);
    await esc.ensureEscrow(b.contractId);
    const termsRaw = await withContractErrors("escrow", () => chain.readRaw(b.contractId, "get_terms"));
    const expected = BigInt((scValToNative(termsRaw) as { amount: bigint }).amount);
    if (parseAmount(b.amount) !== expected) {
      throw new Problem(422, "ESCROW_PROPERTIES_MISMATCH", "El importe no coincide con el de la fianza", `amount debe ser ${toDecimal(expected)}`);
    }
    const args = [new Address(b.signer).toScVal(), inviteScVal(b.inviteCode), termsRaw];
    const built = await withContractErrors("escrow", () => chain.build(b.contractId, "fund_escrow", args, b.signer));
    return c.json(utr(built));
  });

  // approve_release(approver). La aprobación que completa el quórum liquida en la misma transacción.
  r.post(`${SR}/approve-milestones`, async (c) => {
    const b = await parseBody(c, approveBody);
    checkMilestones(b.milestoneIndexes);
    await esc.ensureEscrow(b.contractId);
    const built = await withContractErrors("escrow", () =>
      chain.build(b.contractId, "approve_release", [new Address(b.approver).toScVal()], b.approver),
    );
    return c.json(utr(built));
  });

  // Como en TW: si esta aprobación no completa el quórum (no liquida), 422 ESCROW_NOT_COMPLETED.
  r.post(`${SR}/approve-and-release-milestones`, async (c) => {
    const b = await parseBody(c, approveReleaseBody);
    checkMilestones(b.milestoneIndexes);
    await esc.ensureEscrow(b.contractId);
    const built = await withContractErrors("escrow", () =>
      chain.build(b.contractId, "approve_release", [new Address(b.signer).toScVal()], b.signer),
    );
    if (built.result == null) {
      throw new Problem(422, "ESCROW_NOT_COMPLETED", "Falta la aprobación de la otra parte", "Usa approve-milestones para la primera aprobación");
    }
    return c.json(utr(built));
  });

  // Sin permisos en el fork: `admin` solo firma y paga; se extiende siempre al máximo.
  r.post(`${SR}/extend-ttl`, async (c) => {
    const b = await parseBody(c, extendTtlBody);
    await esc.ensureEscrow(b.contractId);
    const built = await withContractErrors("escrow", () => chain.build(b.contractId, "extend_contract_ttl", [], b.admin));
    return c.json(utr(built));
  });

  r.get(`${SR}/:contractId`, () => {
    throw notImplementedYet("lectura del escrow en forma TW: usa GET /api/fianzas/v1/fianzas/{contractId}/view");
  });
  r.get("/escrows", () => {
    throw notImplementedYet("GET /escrows: usa GET /api/fianzas/v1/landlords/{address}/fianzas");
  });
  r.get("/escrows/*", () => {
    throw notImplementedYet("lecturas /escrows/*: usa las lecturas de /api/fianzas/v1");
  });
  return r;
}
