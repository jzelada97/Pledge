import Link from "next/link";
import { Note, Screen, Tag } from "@/components/wire";
import { QUEUE } from "@/lib/fixtures";
import { STATUS_LABEL, date, money } from "@/lib/format";

export default function Queue() {
  return (
    <Screen title="Stopped deposits" note="Wireframe with fixture data. Only staff accounts from deployments/testnet.json can act.">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-neutral-300 text-left text-neutral-500">
            <th className="py-2">#</th>
            <th>Status</th>
            <th>Deposit</th>
            <th>Yield so far</th>
            <th>Stopped</th>
          </tr>
        </thead>
        <tbody>
          {QUEUE.map((d) => (
            <tr key={d.id.toString()} className="border-b border-dashed border-neutral-300">
              <td className="py-2">
                <Link href={`/deposits/${d.id}`} className="underline">
                  {d.id.toString()}
                </Link>
              </td>
              <td>
                <Tag>{STATUS_LABEL[d.status]}</Tag>
              </td>
              <td>{money(d.data.terms.amount)}</td>
              <td>{money(d.accrued_yield)}</td>
              <td>{date(d.data.dispute.stopped_ts)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Note>A stopped deposit stays in its escrow until the staff resolves it. There is no review deadline.</Note>
    </Screen>
  );
}
