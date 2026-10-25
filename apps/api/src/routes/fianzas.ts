// /fianzas/v1: configuración, estrategias con datos en vivo y precio por share.
// Los builds (crear fianza, fund, approve…) llegan cuando exista la factory desplegada y los bindings.
import { Hono } from "hono";
import { nativeToScVal } from "@stellar/stellar-sdk";
import type { ApiConfig } from "../config";
import { STROOPS, toDecimal, type Chain, type TtlCache } from "../chain";
import { notFound, notImplementedYet } from "../problem";

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
        network: d.network,
      });
    }
    const factory = d.factory;
    const [config, paused, wasm] = await cache.get(`config:${factory}`, CONFIG_TTL, () =>
      Promise.all([
        chain.read<Record<string, unknown>>(factory, "config"),
        chain.read<boolean>(factory, "paused"),
        chain.read<Uint8Array>(factory, "escrow_wasm_hash"),
      ]),
    );
    return c.json({ source: "chain", factory, paused, escrowWasmHash: Buffer.from(wasm).toString("hex"), ...config });
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
        return [f, toDecimal(amounts[0])] as [[number, number], string];
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

  // Builds y lecturas por fianza: dependen de la factory y de packages/bindings (fase 3a).
  const pending = (what: string) => () => {
    throw notImplementedYet(`${what}: pendiente del despliegue de la factory y de los bindings (fase 3a)`);
  };
  r.post("/fianzas/v1/fianzas", pending("crear fianza"));
  r.get("/fianzas/v1/fianzas/by-id/:id", pending("buscar fianza por id"));
  r.get("/fianzas/v1/fianzas/:contractId/*", pending("lecturas de la fianza"));
  r.post("/fianzas/v1/fianzas/:contractId/*", pending("operaciones sobre la fianza"));
  r.get("/fianzas/v1/landlords/:address/fianzas", pending("lista por casero"));
  r.get("/fianzas/v1/tenants/:address/fianzas", pending("lista por inquilino"));

  return r;
}
