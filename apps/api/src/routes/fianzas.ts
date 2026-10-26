// /fianzas/v1: configuración, estrategias con datos en vivo, alta de fianzas (build de
// factory.create_fianza), lecturas por fianza y listas por casero e inquilino (INTERFACES § 8).
// Fondear y aprobar van por las rutas compatibles con TW (routes/tw.ts).
import { Hono } from "hono";
import { z } from "zod";
import { Address, StrKey, nativeToScVal } from "@stellar/stellar-sdk";
import type { ApiConfig } from "../config";
import { STROOPS, toDecimal, type Chain, type TtlCache } from "../chain";
import { withContractErrors } from "../contract-errors";
import { escrowHelpers } from "../escrows";
import { accountAddress, amountInput, contractParam, hex32, parseBody, utr } from "../http";
import { notFound, notImplementedYet, validationError } from "../problem";
import { parseAmount, settlementView, summaryView, termsView, viewView } from "../views";

const MAX_PAGE = 50; // factory MAX_PAGE
const MAX_VIEWS = 25; // factory MAX_VIEWS: ids por llamada a get_fianzas
const STATE_TTL = 5_000;

const createBody = z
  .object({
    signer: accountAddress, // casero
    tenant: accountAddress.nullish(),
    inviteHash: hex32.nullish(),
    amount: amountInput,
    endTs: z.number().int().positive(),
    strategyId: z.string().min(1).max(32).nullish(),
    nonce: hex32.optional(), // si falta, lo genera el servidor y lo devuelve
    expectedConfigVersion: z.number().int().nonnegative().optional(), // si falta, la actual
  })
  .refine((b) => Boolean(b.tenant) !== Boolean(b.inviteHash), {
    message: "indica tenant o inviteHash, exactamente uno",
    path: ["tenant"],
  });

const signerBody = z.object({ signer: accountAddress });

// Cursor opaco de las listas (INTERFACES § 8, convención 4): base64url de { start }.
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

export interface StrategyInfo {
  id: string;
  kind: "defindex" | "noyield";
  vault: string | null;
  assetName: string | null;
  risk: string;
  simulated: boolean;
  enabled: boolean;
  isDefault: boolean;
  vaultFeeBps: number | null;
  protocolFeeBps: number | null;
  pricePerShare: string | null; // USDC por 1 share, string decimal
  supplyApy: number | null; // pendiente del SDK de Blend (apyPool)
  apyLabel: string;
  updatedAt: string;
}

// factory.config() tal como lo decodifica scValToNative (INTERFACES § 3, GlobalConfig).
interface GlobalConfigRaw {
  token: string;
  treasury: string;
  staff: string[];
  platform_fee_bps: number;
  tw_fee_bps: number;
  tw_fee_receiver?: string | null;
  timeout_secs: bigint;
  review_timeout_secs: bigint;
  stop_bond_min: bigint;
  stop_bond_bps: number;
  tenant_yield_bps: number;
  vault_manager?: string | null;
}

const PRICE_TTL = 60_000;
const CONFIG_TTL = 5_000;

export function fianzasRoutes(cfg: ApiConfig, chain: Chain, cache: TtlCache) {
  const r = new Hono();
  const d = cfg.deployments;

  r.get("/fianzas/v1/config", async (c) => {
    if (!d.factory) {
      // Sin factory desplegada, la configuración sale de deployments (misma forma que GlobalConfig).
      return c.json({
        source: "deployments",
        factory: null,
        paused: null,
        escrowWasmHash: d.escrowWasmHash,
        token: d.token,
        treasury: d.treasury,
        staff: d.staff,
        platformFeeBps: d.platformFeeBps,
        twFeeBps: d.twFeeBps,
        twFeeReceiver: d.twFeeReceiver,
        tenantYieldBps: d.tenantYieldBps,
        configVersion: null,
        network: d.network,
      });
    }
    const factory = d.factory;
    const [config, paused, wasm, version] = await cache.get(`config:${factory}`, CONFIG_TTL, () =>
      Promise.all([
        chain.read<GlobalConfigRaw>(factory, "config"),
        chain.read<boolean>(factory, "paused"),
        chain.read<Uint8Array>(factory, "escrow_wasm_hash"),
        chain.read<number>(factory, "config_version"),
      ]),
    );
    // GlobalConfig llega en snake_case y con u64/i128 como BigInt: misma forma que la rama de
    // deployments, con los importes en string (stroops) para no perder precisión en JSON.
    return c.json({
      source: "chain",
      factory,
      paused,
      escrowWasmHash: Buffer.from(wasm).toString("hex"),
      token: config.token,
      treasury: config.treasury,
      staff: config.staff,
      platformFeeBps: Number(config.platform_fee_bps),
      twFeeBps: Number(config.tw_fee_bps),
      twFeeReceiver: config.tw_fee_receiver ?? null,
      tenantYieldBps: Number(config.tenant_yield_bps),
      timeoutSecs: Number(config.timeout_secs),
      reviewTimeoutSecs: Number(config.review_timeout_secs),
      stopBondMin: config.stop_bond_min.toString(),
      stopBondBps: Number(config.stop_bond_bps),
      vaultManager: config.vault_manager ?? null,
      configVersion: Number(version), // FAC-6: el casero firma esta versión en create_fianza
      network: d.network,
    });
  });

  async function strategyInfo(s: (typeof d.strategies)[number]): Promise<StrategyInfo> {
    let fees: [number, number] | null = null;
    let price: string | null = null;
    if (s.vault) {
      const vault = s.vault;
      [fees, price] = await cache.get(`vault:${vault}`, PRICE_TTL, async () => {
        const [f, amounts] = await Promise.all([
          chain.read<[number, number]>(vault, "get_fees"),
          chain.read<bigint[]>(vault, "get_asset_amounts_per_shares", [nativeToScVal(STROOPS, { type: "i128" })]),
        ]);
        // Un vault sin shares emitidas devuelve 0: no hay precio todavía (null), no "vale 0".
        const perShare = amounts[0] ?? 0n;
        return [f, perShare > 0n ? toDecimal(perShare) : null] as [[number, number], string | null];
      });
    }
    return {
      id: s.id,
      kind: s.kind,
      vault: s.vault,
      assetName: s.assetName ?? null,
      risk: s.risk,
      simulated: s.simulated,
      enabled: s.kind === "noyield" || s.vault !== null,
      isDefault: s.default,
      vaultFeeBps: fees?.[0] ?? null,
      protocolFeeBps: fees?.[1] ?? null,
      pricePerShare: price,
      supplyApy: null,
      apyLabel: s.kind === "noyield" ? "sin rendimiento" : "variable",
      updatedAt: new Date().toISOString(),
    };
  }

  r.get("/fianzas/v1/strategies", async (c) => {
    const list = await Promise.all(d.strategies.map(strategyInfo));
    return c.json(list);
  });

  r.get("/fianzas/v1/strategies/:id/price", async (c) => {
    const s = d.strategies.find((x) => x.id === c.req.param("id"));
    if (!s) throw notFound(`No existe la estrategia ${c.req.param("id")}`);
    if (!s.vault) return c.json({ pricePerShare: "1.0000000", asOf: new Date().toISOString(), noYield: true });
    const info = await strategyInfo(s);
    return c.json({ pricePerShare: info.pricePerShare, asOf: info.updatedAt });
  });

  // ---------- Fianzas ----------

  const esc = escrowHelpers(cfg, chain, cache);

  // Build de factory.create_fianza. El contractId sale de predict_address: es estable antes de
  // enviar la transacción (FAC-3), así la UI puede generar la invitación sin esperar.
  r.post("/fianzas/v1/fianzas", async (c) => {
    const factory = esc.requireFactory();
    const b = await parseBody(c, createBody);
    const nonce = b.nonce ? Buffer.from(b.nonce, "hex") : Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
    // FAC-6: si el front no manda la versión que mostró, se usa la actual (la simulación falla
    // con FZ_CONFIG_CHANGED si cambia antes de enviarla).
    const version = b.expectedConfigVersion ?? Number(await chain.read<number>(factory, "config_version"));
    const args = esc.factorySpec().funcArgsToScVals("create_fianza", {
      landlord: b.signer,
      p: {
        tenant: b.tenant ?? undefined,
        invite_hash: b.inviteHash ? Buffer.from(b.inviteHash, "hex") : undefined,
        amount: parseAmount(b.amount),
        end_ts: BigInt(b.endTs),
        strategy_id: b.strategyId ?? undefined,
        nonce,
        expected_config_version: version,
      },
    });
    const [built, contractId] = await withContractErrors("factory", () =>
      Promise.all([
        chain.build(factory, "create_fianza", args, b.signer),
        chain.read<string>(factory, "predict_address", [
          new Address(b.signer).toScVal(),
          nativeToScVal(nonce, { type: "bytes" }),
        ]),
      ]),
    );
    return c.json({ ...utr(built), contractId, nonce: nonce.toString("hex"), configVersion: version });
  });

  r.post("/fianzas/v1/fianzas/batch", () => {
    throw notImplementedYet("Alta por lotes: prevista como Could (create_fianzas_batch)");
  });

  r.get("/fianzas/v1/fianzas/by-id/:id", async (c) => {
    const factory = esc.requireFactory();
    const raw = c.req.param("id");
    if (!/^\d+$/.test(raw)) throw validationError("id debe ser un entero");
    const contractId = await withContractErrors("factory", () =>
      chain.read<string>(factory, "escrow_of", [nativeToScVal(BigInt(raw), { type: "u64" })]),
    );
    return c.json({ id: Number(raw), contractId });
  });

  r.get("/fianzas/v1/fianzas/:contractId/terms", async (c) => {
    const contractId = contractParam(c);
    await esc.ensureEscrow(contractId);
    // Los Terms son inmutables: caché larga.
    const terms = await cache.get(`terms:${contractId}`, 10 * 60_000, () =>
      withContractErrors("escrow", () => chain.read<Record<string, unknown>>(contractId, "get_terms")),
    );
    return c.json({ contractId, ...termsView(terms) });
  });

  r.get("/fianzas/v1/fianzas/:contractId/view", async (c) => {
    const contractId = contractParam(c);
    await esc.ensureEscrow(contractId);
    const v = await cache.get(`view:${contractId}`, STATE_TTL, () =>
      withContractErrors("escrow", () => chain.read<Record<string, unknown>>(contractId, "get_view")),
    );
    return c.json({ contractId, ...viewView(v) });
  });

  r.get("/fianzas/v1/fianzas/:contractId/yield", async (c) => {
    const contractId = contractParam(c);
    await esc.ensureEscrow(contractId);
    const s = await withContractErrors("escrow", () =>
      chain.read<Record<string, unknown>>(contractId, "preview_settlement", [nativeToScVal(0n, { type: "i128" })]),
    );
    const v = settlementView(s);
    // Estimación con el valor de hoy del vault, no garantizada.
    return c.json({
      accruedYield: v.yieldTotal,
      estimatedToTenant: v.toTenant,
      estimatedToLandlord: v.toLandlord,
      estimatedToTreasury: v.toTreasury,
      estimatedToTw: v.toTw,
      asOf: new Date().toISOString(),
    });
  });

  r.get("/fianzas/v1/fianzas/:contractId/preview-settlement", async (c) => {
    const contractId = contractParam(c);
    await esc.ensureEscrow(contractId);
    const deduction = parseAmount(c.req.query("deduction") ?? "0");
    const s = await withContractErrors("escrow", () =>
      chain.read<Record<string, unknown>>(contractId, "preview_settlement", [nativeToScVal(deduction, { type: "i128" })]),
    );
    return c.json(settlementView(s));
  });

  r.post("/fianzas/v1/fianzas/:contractId/cancel", async (c) => {
    const contractId = contractParam(c);
    await esc.ensureEscrow(contractId);
    const b = await parseBody(c, signerBody);
    const built = await withContractErrors("escrow", () => chain.build(contractId, "cancel", [], b.signer));
    return c.json(utr(built));
  });

  // Camino de parada: el escrow aún no tiene estas funciones (las añade P1 tras #48).
  for (const action of ["stop", "assign-expert", "record-report", "resolve", "claim-timeout", "claim-review-timeout"]) {
    r.post(`/fianzas/v1/fianzas/:contractId/${action}`, () => {
      throw notImplementedYet(`${action}: pendiente del camino de parada del escrow`);
    });
  }

  // Listas del panel: índices on-chain de la factory + get_fianzas en lotes (INTERFACES § 8.5).
  async function listBy(role: "landlord" | "tenant", address: string, cursor: string | undefined, limitQ: string | undefined, status: string | undefined) {
    const factory = esc.requireFactory();
    if (!StrKey.isValidEd25519PublicKey(address) && !StrKey.isValidContract(address)) {
      throw validationError("address debe ser una dirección G… o C…");
    }
    const limit = limitQ === undefined ? 20 : Number(limitQ);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw validationError(`limit entre 1 y ${MAX_PAGE}`);
    const start = decodeCursor(cursor);
    const who = new Address(address).toScVal();
    const [total, ids] = await withContractErrors("factory", () =>
      Promise.all([
        chain.read<number>(factory, `count_by_${role}`, [who]),
        chain.read<bigint[]>(factory, `list_by_${role}`, [who, nativeToScVal(start, { type: "u32" }), nativeToScVal(limit, { type: "u32" })]),
      ]),
    );
    const summaries: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += MAX_VIEWS) {
      const chunk = ids.slice(i, i + MAX_VIEWS);
      const got = await withContractErrors("factory", () =>
        chain.read<Record<string, unknown>[]>(factory, "get_fianzas", [nativeToScVal(chunk, { type: "u64" })]),
      );
      summaries.push(...got);
    }
    let data = summaries.map(summaryView);
    // Filtro sobre la página (el índice on-chain no filtra por estado).
    if (status) data = data.filter((f) => f.status.toLowerCase() === status.toLowerCase());
    const next = start + ids.length;
    const hasMore = next < Number(total);
    return { data, hasMore, nextCursor: hasMore ? encodeCursor(next) : null, total: Number(total) };
  }

  r.get("/fianzas/v1/landlords/:address/fianzas", async (c) =>
    c.json(await listBy("landlord", c.req.param("address"), c.req.query("cursor"), c.req.query("limit"), c.req.query("status"))),
  );
  r.get("/fianzas/v1/tenants/:address/fianzas", async (c) =>
    c.json(await listBy("tenant", c.req.param("address"), c.req.query("cursor"), c.req.query("limit"), c.req.query("status"))),
  );

  return r;
}
