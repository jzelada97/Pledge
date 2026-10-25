import Link from "next/link";
import { LinkBtn, Note, Screen, Tag } from "@/components/wire";
import { DEPOSITS } from "@/lib/fixtures";
import { STATUS_LABEL, daysFromNow, money } from "@/lib/format";
import { STRATEGY_COPY } from "@/lib/strategies";

export const dynamic = "force-dynamic"; // "in N days" must be computed per request, not at build time

export default function LandlordDashboard() {
  return (
    <Screen title="My deposits" back="/">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-600">{DEPOSITS.length} deposits</p>
        <LinkBtn href="/landlord/new">New deposit</LinkBtn>
      </div>
      <Note>
        Data: factory.list_by_landlord → get_fianzas (25 per page, no vault calls). Live yield = shares × price per
        share, one read per vault, refreshed every 5 s.
      </Note>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-neutral-300 text-left text-neutral-500">
            <th className="py-2">#</th>
            <th>Status</th>
            <th>Deposit</th>
            <th>Yield so far (estimated)</th>
            <th>Contract end</th>
            <th>Tenant can claim</th>
            <th>Strategy</th>
          </tr>
        </thead>
        <tbody>
          {DEPOSITS.map((d) => (
            <tr key={d.id.toString()} className="border-b border-dashed border-neutral-300">
              <td className="py-2">
                <Link href={`/landlord/deposits/${d.id}`} className="underline">
                  {d.id.toString()}
                </Link>
              </td>
              <td>
                <Tag>{STATUS_LABEL[d.status]}</Tag>
              </td>
              <td>{money(d.data.terms.amount)}</td>
              <td>{d.status === "Proposed" || d.status === "Settled" ? "—" : `${money(d.accrued_yield)}, variable`}</td>
              <td>{daysFromNow(d.data.terms.end_ts)}</td>
              <td>{d.status === "Active" || d.status === "Ending" ? daysFromNow(d.timeout_at) : "—"}</td>
              <td>{STRATEGY_COPY[d.data.terms.strategy.id].name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Screen>
  );
}
