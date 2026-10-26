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
import { Address, FeeBumpTransaction, Keypair, StrKey, TransactionBuilder, nativeToScVal, xdr, type Transaction } from "@stellar/stellar-sdk";
import {
  FianzaError,
  RELEASE_MILESTONE,
  TW_DEPLOYER_TESTNET,
  TW_DEPLOY_FN,
  TW_ESCROW_WASM_TESTNET,
  TW_FEE_ADDRESS_TESTNET,
  TW_FEE_BPS,
  TW_VAULT_TESTNET,
  buildDeployBody,
  buildResolveBody,
  buildStopBody,
  buildWithdrawYieldBody,
  expectedPayout,
  floorToUnits,
  fromDecimal,
  planApproveRelease,
  toDecimal as twDecimal,
  type DistributionsBody,
  type Escrow,
} from "@fianzas/trustless";
import { toDecimal, type Chain, type TtlCache, type UnsignedTransactionResponse } from "../chain";
import { DEFAULT_CLAIM_TIMEOUT_SECS, type ApiConfig } from "../config";
import { rpcUnavailable } from "../tx-policy";
import { accountAddress, amountInput, contractAddress, contractParam, parseBody, utr } from "../http";
import { Problem, notImplementedYet, notSupported, serviceDisabled, validationError } from "../problem";
import { parseAmount } from "../views";
import { withTw, type TwClient } from "./client";
import { deadlineView, engagementIdWithDeadline, escrowView, statusOf, termsView } from "./views";

const STATE_TTL = 5_000;
const MAX_PAGE = 50;
const SR = "/escrow/single-release/v2";
// Los despliegues reales rondan 170 000 stroops de comisión; más de 1 XLM es sospechoso.
const MAX_DEPLOY_FEE_STROOPS = 1_000_000n;

const fundBody = z.object({ contractId: contractAddress, signer: accountAddress, amount: amountInput, inviteCode: z.string().optional() });
const approveBody = z.object({ contractId: contractAddress, approver: accountAddress, milestoneIndexes: z.array(z.number().int()) });
const approveReleaseBody = z.object({ contractId: contractAddress, signer: accountAddress, milestoneIndexes: z.array(z.number().int()) });
const stopBody = z.object({ signer: accountAddress, reasonHash: z.string().optional() });
const resolveBody = z.object({ resolver: accountAddress, deduction: amountInput.or(z.literal(0)), stopJustified: z.boolean() });

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
  fianzaId: z.union([z.string().min(1).max(48), z.number().int().nonnegative()]).optional(),
  /** Fin del alquiler (unix seconds). Va en el engagementId y fija claimableAt = endTs + TW_CLAIM_TIMEOUT_SECS. */
  endTs: z.number().int().positive().max(999_999_999_999).optional(),
  /** Cuenta G que firma el despliegue. Por defecto, la tesorería. */
  signer: accountAddress.optional(),
  vault: accountAddress.optional(),
});
const submitBody = z.object({ signedXdr: z.string().min(1) });
const claimBody = z.object({ signer: accountAddress, disputeTxHash: z.string().regex(/^[0-9a-f]{64}$/i).optional() });

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

/** La única invocación de contrato de la transacción (contrato, función y argumentos), o null. */
function invocationOf(tx: Transaction): { contractId: string; fn: string; args: xdr.ScVal[] } | null {
  const op = tx.operations[0];
  if (tx.operations.length !== 1 || !op || op.type !== "invokeHostFunction") return null;
  if (op.func.switch().name !== "hostFunctionTypeInvokeContract") return null;
  const ic = op.func.invokeContract();
  return { contractId: Address.fromScAddress(ic.contractAddress()).toString(), fn: ic.functionName().toString(), args: ic.args() };
}

/** true si la única operación es la llamada al deployer de TW (`TW_DEPLOYER_TESTNET.tw_new_single_release_escrow`). */
function isDeployTx(tx: Transaction): boolean {
  const op = tx.operations[0];
  if (tx.operations.length !== 1 || !op || op.type !== "invokeHostFunction") return false;
  if (op.func.switch().name !== "hostFunctionTypeInvokeContract") return false;
  const ic = op.func.invokeContract();
  return Address.fromScAddress(ic.contractAddress()).toString() === TW_DEPLOYER_TESTNET && ic.functionName().toString() === TW_DEPLOY_FN;
}

/**
 * Antes de firmar con la clave de la tesorería, se comprueba que lo que devolvió TW es exactamente un
 * despliegue (forma anotada en packages/trustless/CLAUDE.md): origen = tesorería, una llamada al
 * deployer, una sola auth de la cuenta origen sin subinvocaciones y una comisión razonable. Si no,
 * no se firma nada: la API nunca firma a ciegas lo que le manda un tercero.
 */
export function assertDeployToSign(tx: Transaction, treasury: string): void {
  const bad = (why: string) => {
    throw new Problem(502, "FZ_TW_UNEXPECTED_TX", "Trustless Work devolvió una transacción inesperada; no se ha firmado", undefined, undefined, `despliegue inesperado: ${why}`);
  };
  if (tx.source !== treasury) bad(`origen ${tx.source}`);
  if (!isDeployTx(tx)) bad("operación distinta del despliegue");
  const op = tx.operations[0];
  const auth = op?.type === "invokeHostFunction" ? op.auth ?? [] : [];
  const root = auth[0]?.rootInvocation();
  if (auth.length !== 1 || !root) bad(`${auth.length} entradas de auth`);
  if (auth[0]!.credentials().switch().name !== "sorobanCredentialsSourceAccount") bad("auth que no es de la cuenta origen");
  if (root!.subInvocations().length !== 0) bad("auth con subinvocaciones");
  const fn = root!.function();
  if (fn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn" || fn.contractFn().functionName().toString() !== TW_DEPLOY_FN) bad("la raíz de la auth no es el despliegue");
  if (BigInt(tx.fee) > MAX_DEPLOY_FEE_STROOPS) bad(`comisión ${tx.fee}`);
}

export function planARoutes(cfg: ApiConfig, tw: TwClient | null, chain: Chain, cache: TtlCache, now: () => number = Date.now) {
  const r = new Hono();
  const d = cfg.deployments;
  const tenantYieldBps = d.tenantYieldBps;
  const claimTimeoutSecs = cfg.trustless?.claimTimeoutSecs ?? DEFAULT_CLAIM_TIMEOUT_SECS;
  const nowSecs = () => Math.floor(now() / 1000);
  const deadline = () => ({ claimTimeoutSecs, nowSecs: nowSecs() });
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
    const fianzaId = engagementIdWithDeadline(b.fianzaId ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, b.endTs);
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
      // Firma en el servidor (solo si el XDR es el despliegue esperado) y envía por la API de TW, que
      // devuelve la dirección del escrow nuevo.
      assertDeployToSign(tx, d.treasury);
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
    if (!isDeployTx(tx)) throw new Problem(403, "FZ_TX_NOT_ALLOWED", "Transacción no admitida", `Aquí solo se envía el despliegue (${TW_DEPLOY_FN} del deployer de TW); el resto va por /api/stellar/send-transaction`);
    if (tx.signatures.length === 0) throw new Problem(400, "STELLAR_TX_UNSIGNED", "La transacción no lleva firmas; la API nunca firma");
    const sent = await withTw(() => client.sendTransaction(b.signedXdr));
    return c.json({ contractId: sent.contractId ?? sent.escrow?.contractId ?? null, txHash: tx.hash().toString("hex"), status: sent.status ?? "SUCCESS" });
  });

  r.get("/fianzas/v1/fianzas/by-id/:id", () => {
    throw notSupported("En el plan A la fianza se identifica por su contractId (el escrow de TW)", "GET /api/fianzas/v1/fianzas/{contractId}/view");
  });

  r.get("/fianzas/v1/fianzas/:contractId/terms", async (c) => {
    const e = await loadEscrow(contractParam(c));
    return c.json(termsView(e, tenantYieldBps, deadline()));
  });

  r.get("/fianzas/v1/fianzas/:contractId/view", async (c) => {
    const contractId = contractParam(c);
    const client = requireTw();
    const e = await loadEscrow(contractId);
    // El vault es la fuente exacta del rendimiento; si no responde, se estima con el saldo (CT-10).
    const position = await cache.get(`tw:position:${contractId}`, STATE_TTL, () => client.vaultPosition(contractId).catch(() => null));
    return c.json(escrowView(e, tenantYieldBps, position, deadline()));
  });

  r.get("/fianzas/v1/fianzas/:contractId/yield", async (c) => {
    const contractId = contractParam(c);
    const client = requireTw();
    const e = await loadEscrow(contractId);
    const position = await cache.get(`tw:position:${contractId}`, STATE_TTL, () => client.vaultPosition(contractId).catch(() => null));
    const v = escrowView(e, tenantYieldBps, position, deadline());
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

  // ---------- Resolver y repartir el rendimiento (staff, cuenta G con Freighter o CLI) ----------
  const platformFeeBps = cfg.trustless?.platformFeeBps ?? 0;
  // Los importes de TW son `number` y pueden venir en notación exponencial (1e-7): floorToUnits los convierte.
  const distributionsView = (body: DistributionsBody) => body.distributions.map((x) => ({ address: x.address, amount: toDecimal(floorToUnits(x.amount)) }));

  function requireGSigner(who: string, what: string) {
    if (isPasskey(who)) {
      throw new Problem(422, "FZ_SIGNER_MUST_BE_G", `La API de Trustless Work solo admite una cuenta G para ${what}`, "El staff firma con Freighter o con la CLI");
    }
  }

  // resolve(deduction, stopJustified): la deducción va al casero y el resto al inquilino (resolve-dispute de
  // TW). En el plan A no hay bond, así que stopJustified solo sirve para la coherencia que exige INTERFACES.
  r.post("/fianzas/v1/fianzas/:contractId/resolve", async (c) => {
    const client = requireTw();
    const contractId = contractParam(c);
    const b = await parseBody(c, resolveBody);
    const deduction = parseAmount(b.deduction);
    if (b.stopJustified === false && deduction > 0n) {
      throw new Problem(422, "FZ_INCOHERENT_RESOLUTION", "Una parada no justificada no admite deducción", "Con stopJustified = false la deducción debe ser 0");
    }
    requireGSigner(b.resolver, "resolver");
    const e = await loadEscrow(contractId);
    const body = domain(() => buildResolveBody(e, b.resolver, deduction));
    const { unsignedTransaction } = await withTw(() => client.resolveDispute(body));
    return c.json({ ...fromTw(unsignedTransaction, cfg.networkPassphrase), distributions: distributionsView(body), stopJustified: b.stopJustified });
  });

  // Reparto del rendimiento que queda tras liquidar (withdraw-remaining-funds): comisión de plataforma y
  // jurisdicción, con la lógica de @fianzas/trustless. El sobrante exacto sale de getBalances.
  r.post("/fianzas/v1/fianzas/:contractId/distribute-yield", async (c) => {
    const client = requireTw();
    const contractId = contractParam(c);
    const b = await parseBody(c, z.object({ resolver: accountAddress }));
    requireGSigner(b.resolver, "repartir el rendimiento");
    const e = await loadEscrow(contractId);
    const [bal] = await withTw(() => client.getBalances([contractId]));
    const remaining = floorToUnits(bal?.balance ?? 0);
    const body = domain(() => buildWithdrawYieldBody(e, b.resolver, remaining, tenantYieldBps, platformFeeBps));
    const { unsignedTransaction } = await withTw(() => client.withdrawRemainingFunds(body));
    return c.json({ ...fromTw(unsignedTransaction, cfg.networkPassphrase), remaining: toDecimal(remaining), distributions: distributionsView(body), tenantYieldBps, platformFeeBps });
  });

  // Vista previa para el backoffice: cómo quedaría una fianza parada con esa deducción, y el rendimiento que
  // sobraría para repartir. Estimación con el saldo de hoy; nada se mueve.
  r.get("/fianzas/v1/fianzas/:contractId/preview-settlement", async (c) => {
    const contractId = contractParam(c);
    const deduction = parseAmount(c.req.query("deduction") ?? "0");
    const e = await loadEscrow(contractId);
    const resolve = domain(() => buildResolveBody(e, e.roles.disputeResolver, deduction));
    const sumTo = (body: DistributionsBody | null, who: string): bigint =>
      body?.distributions.filter((x) => x.address === who).reduce((s, x) => s + floorToUnits(x.amount), 0n) ?? 0n;
    const principal = resolve.distributions.reduce((s, x) => s + floorToUnits(x.amount), 0n);
    const balance = floorToUnits(e.balance);
    const remaining = balance > principal ? balance - principal : 0n;
    // El reparto del sobrante se calcula como si la fianza ya estuviera resuelta.
    const yieldSplit = remaining > 0n ? buildWithdrawYieldBody({ ...e, flags: { ...e.flags, resolved: true } }, e.roles.disputeResolver, remaining, tenantYieldBps, platformFeeBps) : null;
    return c.json({
      estimated: true,
      total: toDecimal(balance),
      principalBack: toDecimal(principal),
      deduction: toDecimal(deduction < principal ? deduction : principal),
      yieldTotal: toDecimal(remaining),
      toTenant: toDecimal(sumTo(resolve, e.roles.receiver) + sumTo(yieldSplit, e.roles.receiver)),
      toLandlord: toDecimal(sumTo(resolve, e.roles.serviceProvider) + sumTo(yieldSplit, e.roles.serviceProvider)),
      toTreasury: toDecimal(sumTo(yieldSplit, e.roles.platformAddress)),
      // Lo que cobra cada uno: TW descuenta su 0,3 % de cada reparto (18 → 17,946).
      afterTwFee: {
        toTenant: toDecimal(expectedPayout(sumTo(resolve, e.roles.receiver), 0) + expectedPayout(sumTo(yieldSplit, e.roles.receiver), 0)),
        toLandlord: toDecimal(expectedPayout(sumTo(resolve, e.roles.serviceProvider), 0) + expectedPayout(sumTo(yieldSplit, e.roles.serviceProvider), 0)),
        toTreasury: toDecimal(expectedPayout(sumTo(yieldSplit, e.roles.platformAddress), 0)),
      },
      twFeeBps: TW_FEE_BPS, // TW descuenta además su 0,3 % de cada retiro
      tenantYieldBps,
      platformFeeBps,
    });
  });

  r.post("/fianzas/v1/fianzas/:contractId/cancel", () => {
    throw notSupported("El escrow de Trustless Work no se puede cancelar: se libera o se resuelve");
  });
  for (const action of ["assign-expert", "record-report"]) {
    r.post(`/fianzas/v1/fianzas/:contractId/${action}`, () => {
      throw notSupported("El escrow de Trustless Work no guarda el perito ni el informe on-chain; se gestiona en el backoffice", `POST /api/fianzas/v1/fianzas/{contractId}/resolve`);
    });
  }
  // ---------- Liberación a plazo (#115) ----------
  // El escrow de TW no tiene plazos; la regla la aplica la plataforma. Pasado claimableAt sin aprobación
  // del casero, el inquilino abre la disputa (paso 1) y el staff la resuelve con deducción 0 (paso 2) y
  // reparte el sobrante (paso 3). Cada llamada avanza un paso según el estado real del escrow. El paso 2
  // exige el hash de la disputa del inquilino: así una parada del casero anterior al plazo nunca se
  // resuelve sola y va al perito como siempre.
  /** Comprueba que `hash` es la disputa del inquilino sobre este escrow, enviada después de claimableAt. */
  async function verifyTenantDispute(hash: string, contractId: string, tenant: string, claimableAt: number): Promise<void> {
    const bad = (why: string): never => {
      throw new Problem(403, "FZ_CLAIM_NOT_VERIFIED", "disputeTxHash no es la reclamación del inquilino", why, { disputeTxHash: hash });
    };
    let tx;
    try {
      tx = await chain.getTransaction(hash);
    } catch (e) {
      throw rpcUnavailable(`leyendo la transacción ${hash}`, e);
    }
    if (!tx) return bad("la transacción no existe en la red");
    if (!tx.success) return bad("la transacción falló");
    if (tx.envelope instanceof FeeBumpTransaction) return bad("no se admiten fee bumps");
    const inv = invocationOf(tx.envelope);
    if (!inv || inv.contractId !== contractId || inv.fn !== "dispute_escrow") return bad("no es dispute_escrow sobre esta fianza");
    const arg = inv.args[0];
    if (!arg || arg.switch().name !== "scvAddress" || Address.fromScAddress(arg.address()).toString() !== tenant) return bad("no la abrió el inquilino");
    if (tx.createdAt <= claimableAt) return bad("se abrió antes de vencer el plazo: la resuelve el perito");
  }

  /** Firma con el staff (si hay clave) y envía por TW un resolve/withdraw construido por su API. */
  async function signAsStaff(unsignedTransaction: string, contractId: string, fn: "resolve_dispute" | "withdraw_remaining_funds") {
    const client = requireTw();
    const staff = d.staff[0]!;
    const secret = cfg.trustless?.staffSecret ?? null;
    if (!secret) return { signed: false as const, ...fromTw(unsignedTransaction, cfg.networkPassphrase), signer: staff };
    const tx = parseTx(unsignedTransaction, cfg.networkPassphrase);
    const bad = (why: string): never => {
      throw new Problem(502, "FZ_TW_UNEXPECTED_TX", "Trustless Work devolvió una transacción inesperada; no se ha firmado", undefined, undefined, `${fn}: ${why}`);
    };
    const kp = Keypair.fromSecret(secret);
    if (kp.publicKey() !== staff) throw new Problem(500, "FZ_STAFF_KEY_MISMATCH", "STAFF_SECRET no es la cuenta del staff de deployments");
    if (tx.source !== staff) return bad(`origen ${tx.source}`);
    const inv = invocationOf(tx);
    if (!inv || inv.contractId !== contractId || inv.fn !== fn) return bad("contrato o función");
    tx.sign(kp);
    const sent = await withTw(() => client.sendTransaction(tx.toXDR()));
    return { signed: true as const, txHash: tx.hash().toString("hex"), status: sent.status ?? "SUCCESS" };
  }

  r.post("/fianzas/v1/fianzas/:contractId/claim-timeout", async (c) => {
    const client = requireTw();
    const contractId = contractParam(c);
    const b = await parseBody(c, claimBody);
    const e = await loadEscrow(contractId);
    const { endTs, claimableAt } = deadlineView(e, claimTimeoutSecs, nowSecs());
    if (endTs === null || claimableAt === null) {
      throw new Problem(422, "FZ_NO_DEADLINE", "Esta fianza se creó sin fecha de fin", "El engagementId no lleva -end<endTs>");
    }
    if (nowSecs() <= claimableAt) {
      throw new Problem(409, "FZ_TIMEOUT_NOT_REACHED", "Aún no ha vencido el plazo", `claimableAt = ${claimableAt}`, { endTs, claimableAt, claimTimeoutSecs });
    }
    if (e.milestones[0]?.approved) {
      throw new Problem(409, "FZ_ALREADY_APPROVED", "El casero ya aprobó la devolución", "Recupera la fianza con approve-and-release-milestones");
    }
    if (b.signer !== e.roles.receiver) throw new Problem(422, "FZ_NOT_PARTY", "Solo el inquilino de la fianza puede reclamarla");
    const status = statusOf(e);

    if (status === "Active") {
      // Paso 1: el inquilino abre la disputa (TW lo permite: comprobado en testnet).
      const build = isPasskey(b.signer)
        ? utr(await chain.build(contractId, "dispute_escrow", [new Address(b.signer).toScVal()], b.signer))
        : fromTw((await withTw(() => client.dispute({ contractId, signer: b.signer }))).unsignedTransaction, cfg.networkPassphrase);
      return c.json({ step: "dispute", ...build, claimableAt, next: "Firma y envía; después vuelve a llamar con disputeTxHash" });
    }
    if (status === "Stopped") {
      // Paso 2: el staff resuelve con deducción 0 → todo al inquilino. Solo si la disputa es la suya.
      if (!b.disputeTxHash) throw validationError("Falta disputeTxHash: el hash de la disputa que abrió el inquilino");
      await verifyTenantDispute(b.disputeTxHash, contractId, e.roles.receiver, claimableAt);
      const body = domain(() => buildResolveBody(e, d.staff[0]!, 0n));
      const { unsignedTransaction } = await withTw(() => client.resolveDispute(body));
      const res = await signAsStaff(unsignedTransaction, contractId, "resolve_dispute");
      if (!res.signed) return c.json({ step: "resolve", ...res, distributions: distributionsView(body), next: "Firma con el staff, envía por send-transaction y vuelve a llamar" });
      // Paso 3 seguido, si queda sobrante.
      const [bal] = await withTw(() => client.getBalances([contractId]));
      const remaining = floorToUnits(bal?.balance ?? 0);
      let distributed: { txHash: string } | null = null;
      if (remaining > 0n) {
        const wbody = buildWithdrawYieldBody({ ...e, flags: { ...e.flags, resolved: true } }, d.staff[0]!, remaining, tenantYieldBps, platformFeeBps);
        const w = await withTw(() => client.withdrawRemainingFunds(wbody));
        distributed = await signAsStaff(w.unsignedTransaction, contractId, "withdraw_remaining_funds");
      }
      return c.json({ step: "done", resolvedTx: res.txHash, distributions: distributionsView(body), remaining: toDecimal(remaining), distributedTx: distributed?.txHash ?? null });
    }
    if (status === "Settled" && e.flags.resolved) {
      // Paso 3 suelto (cuando el staff firmó a mano el paso 2).
      const [bal] = await withTw(() => client.getBalances([contractId]));
      const remaining = floorToUnits(bal?.balance ?? 0);
      if (remaining === 0n) return c.json({ step: "done", remaining: "0.0000000", distributedTx: null });
      const wbody = domain(() => buildWithdrawYieldBody(e, d.staff[0]!, remaining, tenantYieldBps, platformFeeBps));
      const w = await withTw(() => client.withdrawRemainingFunds(wbody));
      const res = await signAsStaff(w.unsignedTransaction, contractId, "withdraw_remaining_funds");
      if (!res.signed) return c.json({ step: "distribute", ...res, remaining: toDecimal(remaining), distributions: distributionsView(wbody), next: "Firma con el staff y envía por send-transaction" });
      return c.json({ step: "done", remaining: toDecimal(remaining), distributedTx: res.txHash });
    }
    throw new Problem(409, "FZ_BAD_STATUS", "La fianza no admite la reclamación en su estado actual", `estado ${status}`);
  });

  r.post("/fianzas/v1/fianzas/:contractId/claim-review-timeout", () => {
    throw notSupported("El escrow de Trustless Work no tiene plazo de revisión: una parada del casero la resuelve el staff");
  });

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
    let rows = all.map((e) => escrowView(e, tenantYieldBps, undefined, deadline()));
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
