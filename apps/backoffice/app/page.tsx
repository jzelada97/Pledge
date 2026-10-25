import Link from "next/link";
import { Note, Screen, Tag } from "@/components/wire";
import { QUEUE } from "@/lib/fixtures";
import { STATUS_LABEL, date, daysFromNow, money, nowSecs, DAY } from "@/lib/format";

export const dynamic = "force-dynamic"; // review deadlines are relative to now

export default function Queue() {
  return (
    <Screen title="Stopped deposits" note="Wireframe with fixture data. Only staff accounts from deployments/testnet.json can act.">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-neutral-300 text-left text-neutral-500">
            <th className="py-2">#</th>
            <th>Status</th>
            <th>Deposit</th>
            <th>Stopped</th>
            <th>Expert</th>
            <th>Report</th>
            <th>Review deadline</th>
          </tr>
        </thead>
        <tbody>
          {QUEUE.map((d) => {
            const urgent = d.review_deadline - nowSecs() < 3n * DAY;
            return (
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
                <td>{date(d.data.dispute.stopped_ts)}</td>
                <td>{d.data.dispute.expert_ref ? "Assigned" : "—"}</td>
                <td>{d.data.dispute.report_hash ? "Recorded" : "—"}</td>
                <td className={urgent ? "font-semibold text-red-700" : ""}>
                  {daysFromNow(d.review_deadline)}
                  {urgent && " ⚠"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Note>
        If the review deadline passes, anyone can call claim_after_review_timeout: the tenant gets the deposit back and
        the landlord gets the good-faith deposit back.
      </Note>
    </Screen>
  );
}
