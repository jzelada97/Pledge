// Plan A: /fianzas/v1 sobre la API con rendimiento de Trustless Work (issue #84, PR 1: crear y lecturas).
// Mismas rutas que usa el front; cambia solo lo que hay detrás. La lógica de dominio (roles, estados,
// repartos) vive en @fianzas/trustless: aquí solo se traduce HTTP ↔ cliente.
//
// Decisiones (#84): el despliegue lo firma la tesorería en el servidor (TREASURY_SECRET) porque el casero
// puede ser una passkey y la API de TW no la admite como firmante. Sin TREASURY_SECRET, se devuelve el XDR
// sin firmar para que lo firme la tesorería (o el casero, si es una cuenta G) y lo envíe por /submit.
// Las listas por casero e inquilino salen de la propia API de TW (get-escrows-by-role).
import { Hono } from "hono";
import { z } from "zod";
import { Address, FeeBumpTransaction, Keypair, StrKey, TransactionBuilder, nativeToScVal, type Transaction } from "@stellar/stellar-sdk";
import {
  FianzaError,
  RELEASE_MILESTONE,
  TW_ESCROW_WASM_TESTNET,
  TW_FEE_ADDRESS_TESTNET,
  TW_FEE_BPS,
  TW_VAULT_TESTNET,
  buildDeployBody,
  buildStopBody,
  fromDecimal,
  planApproveRelease,
  toDecimal as twDecimal,
  type Escrow,
} from "@fianzas/trustless";
import { toDecimal, type Chain, type TtlCache, type UnsignedTransactionResponse } from "../chain";
import type { ApiConfig } from "../config";
import { accountAddress, amountInput, contractAddress, contractParam, parseBody, utr } from "../http";
import { Problem, notImplementedYet, notSupported, serviceDisabled, validationError } from "../problem";
import { parseAmount } from "../views";
import { withTw, type TwClient } from "./client";
import { escrowView, termsView } from "./views";

const STATE_TTL = 5_000;
const MAX_PAGE = 50;
const DEPLOY_FN = "tw_new_single_release_escrow";
const SR = "/escrow/single-release/v2";

const fundBody = z.object({ contractId: contractAddress, signer: accountAddress, amount: amountInput, inviteCode: z.string().optional() });
const approveBody = z.object({ contractId: contractAddress, approver: accountAddress, milestoneIndexes: z.array(z.number().int()) });
const approveReleaseBody = z.object({ contractId: contractAddress, signer: accountAddress, milestoneIndexes: z.array(z.number().int()) });
const stopBody = z.object({ signer: accountAddress, reasonHash: z.string().optional() });

function checkMilestones(idx: number[]) {
  if (idx.length !== 1 || idx[0] !== Number(RELEASE_MILESTONE)) {
    throw new Problem(422, "ESCROW_INVALID_MILESTONE_INDEX", "La fianza tiene un único milestone: [0]", `milestoneIndexes = ${JSON.stringify(idx)}`);
  }
}

/** Respuesta de un build de TW (`unsignedTransaction`) en la forma de INTERFACES § 8. */
function fromTw(unsignedTransaction: string, passphrase: string): UnsignedTransactionResponse {
  return { unsignedXdr: unsignedTransaction, txHash: parseTx(unsignedTransaction, passphrase).hash().toString("hex") };
}

const createBody = z.object({
  landlord: accountAddress,
  tenant: accountAddress,
  amount: amountInput,
  title: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(500).optional(),
  fianzaId: z.union([z.string().min(1).max(64), z.number().int().nonnegative()]).optional(),
  /** Cuenta G que firma el despliegue. Por defecto, la tesorería. */
  signer: accountAddress.optional(),
  vault: accountAddress.optional(),
});
const submitBody = z.object({ signedXdr: z.string().min(1) });

const encodeCursor = (start: number) => Buffer.from(JSON.stringify({ start })).toString("base64url");
function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const { start } = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { start: unknown };
    if (Number.isInteger(start) && (start as number) >= 0) return start as number;
  } catch {
    // cae al error de abajo
  }
  throw validationError("cursor no válido");
}

/** FianzaError de @fianzas/trustless (roles, estados, importes) → 422 FZ_<CODE>. */
function domain<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof FianzaError) throw new Problem(422, `FZ_${e.code}`, "Operación no válida para esta fianza", e.message);
    throw e;
  }
}

function parseTx(xdr: string, passphrase: string): Transaction {
  let tx;
  try {
    tx = TransactionBuilder.fromXDR(xdr, passphrase);
  } catch {
    throw new Problem(400, "STELLAR_TX_UNPARSEABLE", "signedXdr no es un sobre de transacción válido");
  }
  if (tx instanceof FeeBumpTransaction) throw new Problem(403, "FZ_TX_NOT_ALLOWED", "Transacción no admitida", "No se admiten fee bumps");
  return tx;
}

function isDeployTx(tx: Transaction): boolean {
  const op = tx.operations[0];
  if (tx.operations.length !== 1 || !op || op.type !== "invokeHostFunction") return false;
  if (op.func.switch().name !== "hostFunctionTypeInvokeContract") return false;
  return op.func.invokeContract().functionName().toString() === DEPLOY_FN;
}

export function planARoutes(cfg: ApiConfig, tw: TwClient | null, chain: Chain, cache: TtlCache) {
  const r = new Hono();
  const d = cfg.deployments;
  const tenantYieldBps = d.tenantYieldBps;
  const isPasskey = (addr: string) => StrKey.isValidContract(addr);

  function requireTw(): TwClient {
    if (!tw) throw serviceDisabled("Plan A no configurado: falta TW_API_KEY");
    return tw;
  }

  // La cadena manda (AD-21): la base de datos de TW solo se actualiza con su propio send-transaction, así
  // que flags y milestones se leen del contrato y se superponen a lo que devuelve su API.
  async function loadEscrow(contractId: string): Promise<Escrow> {
    const client = requireTw();
    return cache.get(`tw:escrow:${contractId}`, STATE_TTL, async () => {
      const list = await withTw(() => client.getEscrows([contractId]));
      const e = list[0];
      if (!e) throw new Problem(404, "ESCROW_NOT_FOUND", "No existe esa fianza", `${contractId} no es un escrow de Trustless Work`);
      const onChain = await chain.read<{ flags?: Escrow["flags"]; milestones?: Escrow["milestones"] }>(contractId, "get_escrow").catch(() => null);
      if (!onChain?.flags || !onChain.milestones) return e;
      return { ...e, flags: onChain.flags, milestones: onChain.milestones.map((m) => ({ ...m, status: String(m.status) })) };
    });
  }

  // Tras un envío por el Relayer (passkeys), el front avisa aquí para que el indexador de TW se actualice.
  r.post("/fianzas/v1/indexer", async (c) => {
    const client = requireTw();
    const b = await parseBody(c, z.object({ txHash: z.string().regex(/^[0-9a-f]{64}$/i) }));
    await withTw(() => client.indexTransaction(b.txHash));
    return c.json({ ok: true, txHash: b.txHash });
  });

  r.get("/fianzas/v1/config", (c) =>
    c.json({
      source: "trustless",
      backend: "trustless",
      factory: null,
      paused: false,
      escrowWasmHash: d.network === "testnet" ? TW_ESCROW_WASM_TESTNET : null,
      vault: d.network === "testnet" ? TW_VAULT_TESTNET : null,
      token: d.token,
      treasury: d.treasury,
      staff: d.staff,
      platformFeeBps: 0, // platformFee de TW se cobra sobre el capital: 0 hasta que el equipo decida (#84)
      twFeeBps: TW_FEE_BPS,
      twFeeOnPrincipal: true,
      twFeeReceiver: null,
      tenantYieldBps,
      configVersion: null,
      network: d.network,
    }),
  );

  // Crear la fianza = desplegar el escrow de TW con la passkey (o cuenta) del inquilino ya en los roles:
  // en el plan A el escrow se crea cuando el inquilino acepta la invitación (hace falta su dirección).
  r.post("/fianzas/v1/fianzas", async (c) => {
    const client = requireTw();
    const b = await parseBody(c, createBody);
    const signer = b.signer ?? d.treasury;
    if (!StrKey.isValidEd25519PublicKey(signer)) {
      throw new Problem(422, "FZ_SIGNER_MUST_BE_G", "La API de Trustless Work solo admite una cuenta G como firmante del despliegue", "Deja signer vacío para que firme la tesorería");
    }
    const staff = d.staff[0];
    if (!staff) throw serviceDisabled("deployments.staff está vacío");
    const fianzaId = b.fianzaId ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const body = domain(() =>
      buildDeployBody({
        fianzaId,
        parties: { landlord: b.landlord, tenant: b.tenant, treasury: d.treasury, staff },
        amount: parseAmount(b.amount),
        assetIssuer: d.tokenIssuer,
        title: b.title,
        description: b.description,
        signer,
        vault: b.vault,
      }),
    );
    const { unsignedTransaction } = await withTw(() => client.deploy(body));
    const tx = parseTx(unsignedTransaction, cfg.networkPassphrase);

    const secret = cfg.trustless?.treasurySecret ?? null;
    if (signer === d.treasury && secret) {
      // Firma en el servidor y envía por la API de TW, que devuelve la dirección del escrow nuevo.
      tx.sign(Keypair.fromSecret(secret));
      const sent = await withTw(() => client.sendTransaction(tx.toXDR()));
      const contractId = sent.contractId ?? sent.escrow?.contractId ?? null;
      return c.json({ contractId, engagementId: body.engagementId, txHash: tx.hash().toString("hex"), status: sent.status ?? "SUCCESS", signedBy: "treasury" });
    }
    // Sin clave en el servidor (o firmante distinto): bucle build → sign → submit de INTERFACES § 8.
    return c.json({
      unsignedXdr: unsignedTransaction,
      txHash: tx.hash().toString("hex"),
      contractId: null,
      engagementId: body.engagementId,
      signer,
      submitPath: "/api/fianzas/v1/fianzas/submit",
    });
  });

  // Envío del despliegue firmado fuera. Solo acepta la llamada al deployer de TW, nada más.
  r.post("/fianzas/v1/fianzas/submit", async (c) => {
    const client = requireTw();
    const b = await parseBody(c, submitBody);
    const tx = parseTx(b.signedXdr, cfg.networkPassphrase);
    if (!isDeployTx(tx)) throw new Problem(403, "FZ_TX_NOT_ALLOWED", "Transacción no admitida", `Aquí solo se envía el despliegue (${DEPLOY_FN}); el resto va por /api/stellar/send-transaction`);
    if (tx.signatures.length === 0) throw new Problem(400, "STELLAR_TX_UNSIGNED", "La transacción no lleva firmas; la API nunca firma");
    const sent = await withTw(() => client.sendTransaction(b.signedXdr));
    return c.json({ contractId: sent.contractId ?? sent.escrow?.contractId ?? null, txHash: tx.hash().toString("hex"), status: sent.status ?? "SUCCESS" });
  });

  r.get("/fianzas/v1/fianzas/by-id/:id", () => {
    throw notSupported("En el plan A la fianza se identifica por su contractId (el escrow de TW)", "GET /api/fianzas/v1/fianzas/{contractId}/view");
  });

  r.get("/fianzas/v1/fianzas/:contractId/terms", async (c) => {
    const e = await loadEscrow(contractParam(c));
    return c.json(termsView(e, tenantYieldBps));
  });

  r.get("/fianzas/v1/fianzas/:contractId/view", async (c) => {
    const contractId = contractParam(c);
    const client = requireTw();
    const e = await loadEscrow(contractId);
    // El vault es la fuente exacta del rendimiento; si no responde, se estima con el saldo (CT-10).
    const position = await cache.get(`tw:position:${contractId}`, STATE_TTL, () => client.vaultPosition(contractId).catch(() => null));
    return c.json(escrowView(e, tenantYieldBps, position));
  });

  r.get("/fianzas/v1/fianzas/:contractId/yield", async (c) => {
    const contractId = contractParam(c);
    const client = requireTw();
    const e = await loadEscrow(contractId);
    const position = await cache.get(`tw:position:${contractId}`, STATE_TTL, () => client.vaultPosition(contractId).catch(() => null));
    const v = escrowView(e, tenantYieldBps, position);
    return c.json({
      accruedYield: v.accruedYield,
      expectedPayout: v.expectedPayout,
      // Plan A: al liberar, TW paga capital y rendimiento al inquilino (hueco pendiente del equipo, #84).
      estimatedToTenant: v.expectedPayout,
      estimatedToLandlord: "0.0000000",
      estimatedToTreasury: "0.0000000",
      asOf: new Date().toISOString(),
    });
  });

  // ---------- Acciones (build → sign → submit) ----------
  // Cuenta G: el cuerpo lo construye la API de TW (la cuenta firma el XDR y lo envía por
  // /stellar/send-transaction). Passkey (C…): la API de TW no la admite como firmante (#61), así que la
  // llamada se construye contra el propio contrato del escrow y se firma/envía por el Relayer (#82 C).

  // fund_escrow(signer, expected_escrow, amount): el escrow actual se lee de la cadena y se reenvía tal cual.
  r.post(`${SR}/fund`, async (c) => {
    const client = requireTw();
    const b = await parseBody(c, fundBody);
    const e = await loadEscrow(b.contractId);
    const amount = parseAmount(b.amount);
    if (amount !== fromDecimal(e.amount)) {
      throw new Problem(422, "ESCROW_PROPERTIES_MISMATCH", "El importe no coincide con el de la fianza", `amount debe ser ${toDecimal(fromDecimal(e.amount))}`);
    }
    if (b.signer !== e.roles.receiver) throw new Problem(422, "FZ_NOT_PARTY", "Solo el inquilino de la fianza puede depositarla");
    if (!isPasskey(b.signer)) {
      const { unsignedTransaction } = await withTw(() => client.fund({ contractId: b.contractId, signer: b.signer, amount: twDecimal(amount) }));
      return c.json(fromTw(unsignedTransaction, cfg.networkPassphrase));
    }
    const expected = await chain.readRaw(b.contractId, "get_escrow");
    const built = await chain.build(b.contractId, "fund_escrow", [new Address(b.signer).toScVal(), expected, nativeToScVal(amount, { type: "i128" })], b.signer);
    return c.json(utr(built));
  });

  async function approveOrRelease(contractId: string, who: string, mustRelease: boolean) {
    const client = requireTw();
    const e = await loadEscrow(contractId);
    const notCompleted = () => new Problem(422, "ESCROW_NOT_COMPLETED", "Falta la aprobación del casero", "Usa approve-milestones para la aprobación del casero");
    let action;
    try {
      action = domain(() => planApproveRelease(e, who));
    } catch (err) {
      // Como en TW: liberar antes de que el casero apruebe es ESCROW_NOT_COMPLETED.
      if (mustRelease && err instanceof Problem && err.code === "FZ_NOT_APPROVED") throw notCompleted();
      throw err;
    }
    if (mustRelease && action.kind !== "release") throw notCompleted();
    if (action.kind === "approve") {
      if (!isPasskey(who)) {
        const { unsignedTransaction } = await withTw(() => client.approveMilestone(action.body));
        return fromTw(unsignedTransaction, cfg.networkPassphrase);
      }
      return utr(await chain.build(contractId, "approve_milestone", [nativeToScVal(Number(RELEASE_MILESTONE), { type: "u32" }), new Address(who).toScVal()], who));
    }
    if (!isPasskey(who)) {
      const { unsignedTransaction } = await withTw(() => client.releaseFunds(action.body));
      return fromTw(unsignedTransaction, cfg.networkPassphrase);
    }
    // release_funds(release_signer, trustless_work_address): la comisión de TW va a su dirección fija.
    return utr(await chain.build(contractId, "release_funds", [new Address(who).toScVal(), new Address(TW_FEE_ADDRESS_TESTNET).toScVal()], who));
  }

  // Casero: aprueba el hito. Inquilino (tras la aprobación): libera.
  r.post(`${SR}/approve-milestones`, async (c) => {
    const b = await parseBody(c, approveBody);
    checkMilestones(b.milestoneIndexes);
    return c.json(await approveOrRelease(b.contractId, b.approver, false));
  });
  r.post(`${SR}/approve-and-release-milestones`, async (c) => {
    const b = await parseBody(c, approveReleaseBody);
    checkMilestones(b.milestoneIndexes);
    return c.json(await approveOrRelease(b.contractId, b.signer, true));
  });

  // Parar: solo el casero y solo antes de aprobar. TW no guarda el motivo on-chain (reasonHash se ignora).
  r.post("/fianzas/v1/fianzas/:contractId/stop", async (c) => {
    const client = requireTw();
    const contractId = contractParam(c);
    const b = await parseBody(c, stopBody);
    const e = await loadEscrow(contractId);
    const body = domain(() => buildStopBody(e, b.signer));
    if (!isPasskey(b.signer)) {
      const { unsignedTransaction } = await withTw(() => client.dispute(body));
      return c.json({ ...fromTw(unsignedTransaction, cfg.networkPassphrase), stopBond: null });
    }
    return c.json({ ...utr(await chain.build(contractId, "dispute_escrow", [new Address(b.signer).toScVal()], b.signer)), stopBond: null });
  });

  for (const action of ["cancel"]) {
    r.post(`/fianzas/v1/fianzas/:contractId/${action}`, () => {
      throw notSupported("El escrow de Trustless Work no se puede cancelar: se libera o se resuelve");
    });
  }
  for (const action of ["assign-expert", "record-report", "resolve", "claim-timeout", "claim-review-timeout", "preview-settlement"]) {
    r.all(`/fianzas/v1/fianzas/:contractId/${action}`, () => {
      throw notImplementedYet(`${action}: llega en los siguientes PR de #84`);
    });
  }

  // Listas del panel: la API de TW indexa por rol. El casero es approver; el inquilino, receiver.
  async function listBy(role: "approver" | "receiver", address: string, cursor: string | undefined, limitQ: string | undefined, status: string | undefined) {
    const client = requireTw();
    if (!StrKey.isValidEd25519PublicKey(address) && !StrKey.isValidContract(address)) {
      throw validationError("address debe ser una dirección G… o C…");
    }
    const limit = limitQ === undefined ? 20 : Number(limitQ);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw validationError(`limit entre 1 y ${MAX_PAGE}`);
    const start = decodeCursor(cursor);
    const all = await cache.get(`tw:role:${role}:${address}`, STATE_TTL, () => withTw(() => client.getEscrowsByRole(role, address)));
    let rows = all.map((e) => escrowView(e, tenantYieldBps));
    if (status) rows = rows.filter((f) => f.status.toLowerCase() === status.toLowerCase());
    const page = rows.slice(start, start + limit);
    const next = start + page.length;
    const hasMore = next < rows.length;
    return { data: page, hasMore, nextCursor: hasMore ? encodeCursor(next) : null, total: rows.length };
  }

  r.get("/fianzas/v1/landlords/:address/fianzas", async (c) =>
    c.json(await listBy("approver", c.req.param("address"), c.req.query("cursor"), c.req.query("limit"), c.req.query("status"))),
  );
  r.get("/fianzas/v1/tenants/:address/fianzas", async (c) =>
    c.json(await listBy("receiver", c.req.param("address"), c.req.query("cursor"), c.req.query("limit"), c.req.query("status"))),
  );

  return r;
}
