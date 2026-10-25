import { notFound } from "next/navigation";
import { SignButton } from "@/components/sign-button";
import { Box, Note, Row, Screen, Tag } from "@/components/wire";
import { depositById } from "@/lib/fixtures";
import { date, money, percent } from "@/lib/format";
import { RISK_LABEL, STRATEGY_COPY } from "@/lib/strategies";
import { yieldGoesTo } from "@/lib/yield-policy";

// Tenant invitation: /i/<id>#c=<code>. Everything shown is read from the chain (get_terms + config),
// never from the URL (WEB-11 v2). The id resolves to the escrow with factory.escrow_of(id).
export default async function Invitation({ params }: PageProps<"/i/[id]">) {
  const { id } = await params;
  const d = depositById(id);
  if (!d) notFound();

  if (d.status !== "Proposed") {
    return (
      <Screen title="This link is no longer valid" back="/" narrow>
        <p className="text-sm text-neutral-600">Ask your landlord to send you a new invitation.</p>
      </Screen>
    );
  }

  const { terms } = d.data;
  const copy = STRATEGY_COPY[terms.strategy.id];
  const reviewDays = Number(terms.review_timeout_secs) / 86_400;

  return (
    <Screen title="Your room deposit" back="/" narrow>
      <Box title="What you're agreeing to">
        <Row label="Deposit" value={money(terms.amount)} />
        <Row label="Contract ends" value={date(terms.end_ts)} />
        <Row label="You get it back in full" value="When you and your landlord approve" />
        <Row label="If your landlord doesn't respond" value={`You can claim it from ${date(d.timeout_at)}`} />
        <Row label="The yield after the platform fee goes to" value={yieldGoesTo(terms.tenant_yield_bps, "tenant")} />
        <Row label="Platform fee (on the yield only)" value={percent(terms.platform_fee_bps)} />
        <Row label="Your landlord pays to stop the release" value={money(terms.stop_bond)} />
        <Row label="If stopped, decided by" value={`Fianzas staff, within ${reviewDays} days`} />
      </Box>

      <Box title="Where your deposit is kept">
        <div className="flex flex-wrap gap-1">
          <Tag>{copy.name}</Tag>
          <Tag>{RISK_LABEL[terms.strategy.risk]}</Tag>
          {terms.strategy.simulated && <Tag>Simulated yield</Tag>}
        </div>
        <p className="text-sm">{copy.apy}</p>
        <p className="text-sm text-neutral-600">{copy.risks}</p>
      </Box>

      <Box title="1 · Sign in or create your account">
        <SignButton label="Continue with Face ID" />
        <p className="text-sm text-neutral-600">
          Already have an account? Face ID signs you in. New here? We create one for you. No app to install, no fees.
        </p>
        <Note>wallet.connect() first (silent reconnect); if it returns null, wallet.createAccount().</Note>
      </Box>

      <Box title="2 · Add the money from your bank">
        <Tag>Simulated bank deposit</Tag>
        <SignButton label={`Add ${money(terms.amount)} from my bank`} />
        <Note>Shows the &quot;Simulated&quot; label while anchor.isSimulated is true.</Note>
      </Box>

      <Box title="3 · Accept and pay the deposit">
        <SignButton label="Accept and pay" />
        <Note>
          Before asking for Face ID we check these terms match the platform&apos;s (WEB-14). If not, we block it and show:
          &quot;These terms don&apos;t match the platform&apos;s.&quot;
        </Note>
      </Box>
    </Screen>
  );
}
