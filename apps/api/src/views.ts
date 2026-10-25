// Tipos del contrato (tal como los decodifica scValToNative: snake_case, u64/i128 como BigInt,
// enums de unidad como ["Active"], BytesN como Buffer) → JSON de la API: camelCase e importes
// en string decimal (INTERFACES § 8, convenciones 3 y 6).
import { Problem } from "./problem";
import { toDecimal } from "./chain";

const DECIMALS = 7;

/** "10", 10, "10.5" → stroops. Más de 7 decimales → AMOUNT_PRECISION_UNSUPPORTED (como TW). */
export function parseAmount(v: number | string): bigint {
  const s = typeof v === "number" ? v.toString() : v.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Problem(400, "VALIDATION_ERROR", "Petición no válida", `Importe no válido: ${s}`);
  const frac = m[2] ?? "";
  if (frac.length > DECIMALS) {
    throw new Problem(422, "AMOUNT_PRECISION_UNSUPPORTED", "El importe tiene más de 7 decimales", s);
  }
  return BigInt(m[1]) * 10n ** BigInt(DECIMALS) + BigInt(frac.padEnd(DECIMALS, "0") || "0");
}

type Raw = Record<string, any>;

const tag = (v: unknown): string => (Array.isArray(v) ? String(v[0]) : String(v));
const hex = (v: unknown): string | null => (v == null ? null : Buffer.from(v as Uint8Array).toString("hex"));
const num = (v: unknown): number => Number(v);
const opt = <T>(v: T | null | undefined): T | null => (v === undefined ? null : v);

export function strategyView(s: Raw) {
  return {
    id: String(s.id),
    kind: tag(s.kind) === "NoYield" ? ("noyield" as const) : ("defindex" as const),
    vault: opt(s.vault),
    asset: s.asset,
    assetName: s.asset_name,
    risk: tag(s.risk).toLowerCase(),
    simulated: Boolean(s.simulated),
    enabled: Boolean(s.enabled),
    maxVaultFeeBps: num(s.max_vault_fee_bps),
  };
}

export function termsView(t: Raw) {
  return {
    id: num(t.id),
    factory: t.factory,
    landlord: t.landlord,
    amount: toDecimal(t.amount),
    endTs: num(t.end_ts),
    tenantYieldBps: num(t.tenant_yield_bps),
    strategy: strategyView(t.strategy),
    // Todas las comisiones fijadas al crear (INTERFACES § 9).
    platformFeeBps: num(t.platform_fee_bps),
    twFeeBps: num(t.tw_fee_bps),
    twFeeReceiver: opt(t.tw_fee_receiver),
    defindexVaultFeeBps: num(t.defindex_vault_fee_bps),
    defindexProtocolFeeBps: num(t.defindex_protocol_fee_bps),
    treasury: t.treasury,
    disputeResolvers: t.dispute_resolvers,
    timeoutSecs: num(t.timeout_secs),
    reviewTimeoutSecs: num(t.review_timeout_secs),
    stopBond: toDecimal(t.stop_bond),
  };
}

export function settlementView(s: Raw) {
  return {
    total: toDecimal(s.total),
    yieldTotal: toDecimal(s.yield_total),
    deduction: toDecimal(s.deduction),
    toTenant: toDecimal(s.to_tenant),
    toLandlord: toDecimal(s.to_landlord),
    toTreasury: toDecimal(s.to_treasury),
    toTw: toDecimal(s.to_tw),
  };
}

export function escrowView(e: Raw, effectiveStatus?: unknown) {
  const status = tag(e.status);
  const settled = status === "Settled";
  return {
    terms: termsView(e.terms),
    tenant: opt(e.tenant),
    hasInvite: e.invite_hash != null,
    status: effectiveStatus === undefined ? status : tag(effectiveStatus),
    storedStatus: status,
    approvals: {
      target: num(e.approvals.target),
      count: num(e.approvals.approval_count),
      approvedBy: e.approvals.approved_by,
    },
    shares: String(e.shares),
    createdTs: num(e.created_ts),
    fundedTs: num(e.funded_ts),
    dispute: {
      reasonHash: hex(e.dispute.reason_hash),
      stoppedTs: num(e.dispute.stopped_ts),
      expertRef: hex(e.dispute.expert_ref),
      reportHash: hex(e.dispute.report_hash),
      bondHeld: toDecimal(e.dispute.bond_held),
      stopJustified: opt(e.dispute.stop_justified),
    },
    // En el escrow de main `settlement`/`path` no son Option: solo tienen sentido si está liquidada.
    settlement: settled && e.settlement ? settlementView(e.settlement) : null,
    path: settled && e.path != null ? tag(e.path) : null,
  };
}

/** `EscrowView` (get_view, #48): estado efectivo, plazos y rendimiento estimado. */
export function viewView(v: Raw) {
  return {
    ...escrowView(v.data, v.status),
    accruedYield: toDecimal(v.accrued_yield),
    timeoutAt: num(v.timeout_at),
    reviewDeadline: num(v.review_deadline),
  };
}

/** `FianzaSummary` de factory.get_fianzas. */
export function summaryView(s: Raw) {
  return { id: num(s.id), contractId: s.escrow, ...escrowView(s.data, s.status) };
}
