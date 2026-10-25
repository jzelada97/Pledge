import { computeStopBond, split } from "./split";
import { DAY, nowSecs, toUnits } from "./format";
import { strategyById } from "./strategies";
import type { EscrowView, FianzaSummary, Status } from "./types";

// Static data shaped like factory.get_fianzas() + escrow.get_view(), until the contracts are deployed.
// Values follow the demo GlobalConfig in docs/INTERFACES.md §3, with production-like timeouts.
export const CONFIG = {
  platform_fee_bps: 2000,
  stop_bond_min: toUnits(10),
  stop_bond_bps: 500,
  tenant_yield_bps: 0, // set per jurisdiction in GlobalConfig (issue #16). MVP: Portugal, all net yield to the landlord
  timeout_secs: 30n * DAY,
  review_timeout_secs: 30n * DAY,
};

export const ME_LANDLORD = "FIXTURE_LANDLORD";
export const ME_TENANT = "FIXTURE_TENANT";

export type DepositRow = FianzaSummary & Pick<EscrowView, "accrued_yield" | "timeout_at" | "review_deadline">;

interface Opts {
  amount: number;
  endInDays: number;
  fundedDaysAgo?: number;
  strategyId?: string;
  accrued?: number;
  approvedBy?: string[];
  stoppedDaysAgo?: number;
  expert?: boolean;
  report?: boolean;
}

function row(id: number, status: Status, o: Opts): DepositRow {
  const now = nowSecs();
  const amount = toUnits(o.amount);
  const end_ts = now + BigInt(o.endInDays) * DAY;
  const funded = o.fundedDaysAgo !== undefined;
  const stopped_ts = o.stoppedDaysAgo !== undefined ? now - BigInt(o.stoppedDaysAgo) * DAY : 0n;
  const accrued = toUnits(o.accrued ?? 0);
  const approvedBy = o.approvedBy ?? [];
  const settled = status === "Settled";
  return {
    id: BigInt(id),
    escrow: `FIXTURE_ESCROW_${id}`,
    status,
    accrued_yield: settled ? 0n : accrued,
    timeout_at: end_ts + CONFIG.timeout_secs,
    review_deadline: stopped_ts ? stopped_ts + CONFIG.review_timeout_secs : 0n,
    data: {
      terms: {
        factory: "FIXTURE_FACTORY",
        id: BigInt(id),
        landlord: ME_LANDLORD,
        amount,
        end_ts,
        tenant_yield_bps: CONFIG.tenant_yield_bps,
        strategy: strategyById(o.strategyId ?? "usdc_fixed"),
        platform_fee_bps: CONFIG.platform_fee_bps,
        treasury: "FIXTURE_TREASURY",
        dispute_resolvers: ["FIXTURE_STAFF"],
        timeout_secs: CONFIG.timeout_secs,
        review_timeout_secs: CONFIG.review_timeout_secs,
        stop_bond: computeStopBond(amount, CONFIG.stop_bond_min, CONFIG.stop_bond_bps),
      },
      tenant: funded ? ME_TENANT : null,
      invite_hash: funded ? null : "FIXTURE_INVITE_HASH",
      status: status === "Ending" ? "Active" : status, // Ending is derived, never stored
      approvals: { target: 2, approval_count: approvedBy.length, approved_by: approvedBy },
      shares: funded ? amount : 0n,
      created_ts: now - BigInt((o.fundedDaysAgo ?? 0) + 2) * DAY,
      funded_ts: funded ? now - BigInt(o.fundedDaysAgo!) * DAY : 0n,
      dispute: {
        reason_hash: stopped_ts ? "FIXTURE_REASON_HASH" : null,
        stopped_ts,
        expert_ref: o.expert ? "FIXTURE_EXPERT_REF" : null,
        report_hash: o.report ? "FIXTURE_REPORT_HASH" : null,
        bond_held: stopped_ts ? computeStopBond(amount, CONFIG.stop_bond_min, CONFIG.stop_bond_bps) : 0n,
        stop_justified: null,
      },
      settlement: settled ? split(amount, amount + accrued, 0n, CONFIG.platform_fee_bps, CONFIG.tenant_yield_bps) : null,
      path: settled ? "Approved" : null,
    },
  };
}

export const DEPOSITS: DepositRow[] = [
  row(1, "Proposed", { amount: 800, endInDays: 300 }),
  row(2, "Active", { amount: 1200, endInDays: 305, fundedDaysAgo: 60, accrued: 12.4 }),
  row(3, "Ending", { amount: 950, endInDays: -2, fundedDaysAgo: 365, accrued: 58.1, approvedBy: [ME_TENANT] }),
  row(4, "Stopped", { amount: 1100, endInDays: -5, fundedDaysAgo: 370, accrued: 66.9, stoppedDaysAgo: 1 }),
  row(5, "UnderReview", { amount: 700, endInDays: -10, fundedDaysAgo: 380, accrued: 44.2, stoppedDaysAgo: 6, expert: true, report: true }),
  row(6, "Settled", { amount: 1000, endInDays: -40, fundedDaysAgo: 400, accrued: 61.0, approvedBy: [ME_TENANT, ME_LANDLORD] }),
  row(7, "Active", { amount: 650, endInDays: 120, fundedDaysAgo: 30, strategyId: "usdc_mock", accrued: 3.3 }),
];

export function depositById(id: string): DepositRow | undefined {
  return DEPOSITS.find((d) => d.id.toString() === id);
}
