import { DAY, nowSecs, toUnits } from "./format";
import { computeStopBond } from "./split";
import type { EscrowView, Status } from "./types";

// Stopped deposits as the staff queue will read them (escrow.get_view), until the contracts are deployed.
// Same ids as the apps/web fixtures so the demo story matches across both apps.
export const STAFF = "FIXTURE_STAFF";
export const PLATFORM_FEE_BPS = 2000;
const REVIEW_TIMEOUT = 30n * DAY;

export type StoppedRow = EscrowView & { id: bigint };

function row(id: number, status: Status, o: { amount: number; stoppedDaysAgo: number; accrued: number; tenantBps: number; expert?: boolean; report?: boolean }): StoppedRow {
  const now = nowSecs();
  const amount = toUnits(o.amount);
  const stopped_ts = now - BigInt(o.stoppedDaysAgo) * DAY;
  const bond = computeStopBond(amount, toUnits(10), 500);
  return {
    id: BigInt(id),
    status,
    accrued_yield: toUnits(o.accrued),
    timeout_at: stopped_ts + 30n * DAY,
    review_deadline: stopped_ts + REVIEW_TIMEOUT,
    data: {
      terms: {
        factory: "FIXTURE_FACTORY",
        id: BigInt(id),
        landlord: "FIXTURE_LANDLORD",
        amount,
        end_ts: stopped_ts - 2n * DAY,
        tenant_yield_bps: o.tenantBps,
        strategy: { id: "usdc_fixed", kind: "DeFindexVault", vault: "FIXTURE_VAULT", asset: "FIXTURE_USDC", asset_name: "USDC:FIXTURE_ISSUER", defindex_strategy: null, apy_pool: null, risk: "Standard", simulated: false, enabled: true },
        platform_fee_bps: PLATFORM_FEE_BPS,
        treasury: "FIXTURE_TREASURY",
        dispute_resolvers: [STAFF],
        timeout_secs: 30n * DAY,
        review_timeout_secs: REVIEW_TIMEOUT,
        stop_bond: bond,
      },
      tenant: "FIXTURE_TENANT",
      invite_hash: null,
      status,
      approvals: { target: 2, approval_count: 0, approved_by: [] },
      shares: amount,
      created_ts: stopped_ts - 380n * DAY,
      funded_ts: stopped_ts - 370n * DAY,
      dispute: {
        reason_hash: "FIXTURE_REASON_HASH",
        stopped_ts,
        expert_ref: o.expert ? "FIXTURE_EXPERT_REF" : null,
        report_hash: o.report ? "FIXTURE_REPORT_HASH" : null,
        bond_held: bond,
        stop_justified: null,
      },
      settlement: null,
      path: null,
    },
  };
}

export const QUEUE: StoppedRow[] = [
  row(4, "Stopped", { amount: 1100, stoppedDaysAgo: 1, accrued: 66.9, tenantBps: 10000 }),
  row(5, "UnderReview", { amount: 700, stoppedDaysAgo: 6, accrued: 44.2, tenantBps: 10000, expert: true, report: true }),
  row(8, "UnderReview", { amount: 900, stoppedDaysAgo: 28, accrued: 51.7, tenantBps: 5000, expert: true }),
];

export function stoppedById(id: string): StoppedRow | undefined {
  return QUEUE.find((d) => d.id.toString() === id);
}
