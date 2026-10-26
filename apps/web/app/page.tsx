import { ChevronRightIcon, LandmarkIcon, ScaleIcon, ScanFaceIcon, ShieldCheckIcon, SproutIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DepositPass } from "@/components/deposit-pass";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { CONFIG } from "@/lib/fixtures";
import { DAY, nowSecs, toUnits } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";


// apple.com-style product page: centred headline and two pill actions, the product (a deposit pass) as the
// hero image, a bento grid of facts, then one panel per side of the deposit.
export default async function Home() {
  const { t, f } = await getI18n();
  const h = t.home;
  return (
    <>
      <SiteHeader />
      <main className="overflow-x-clip">
        <section className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 pt-14 text-center sm:pt-20">
          <h1 className="text-5xl font-semibold tracking-tight text-balance sm:text-7xl">{h.title}</h1>
          <p className="max-w-2xl text-lg text-muted-foreground sm:text-xl">{h.lead}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/landlord">{h.imLandlord}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/tenant">{h.imTenant}</Link>
            </Button>
          </div>

          {/* The product shot: a tilted pass over a soft tonal glow */}
          <figure className="relative mt-10 w-full max-w-sm pb-4 sm:mt-14">
            <div aria-hidden className="absolute inset-x-6 top-10 bottom-0 rounded-full bg-primary/20 blur-3xl" />
            <DepositPass
              title={t.common.deposit("2")}
              amount={f.money(toUnits(1200))}
              statusLabel={t.status.Active}
              note={h.passNote}
              facts={[
                { label: t.tenant.contractEnds, value: f.date(nowSecs() + 300n * DAY) },
                { label: h.passYield, value: h.passVariable },
              ]}
              className="relative -rotate-3 text-left"
            />
            <figcaption className="mt-6 text-sm text-muted-foreground">{h.passCaption}</figcaption>
          </figure>
        </section>

        <section aria-labelledby="facts-title" className="mx-auto max-w-5xl px-4 py-20">
          <h2 id="facts-title" className="mb-8 text-3xl font-semibold tracking-tight sm:text-4xl">
            {h.factsTitle}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-3">
            <Tile dark className="sm:col-span-2" icon={ShieldCheckIcon} title={h.full.title}>
              {h.full.body}
            </Tile>
            <Tile warm icon={SproutIcon} title={h.earns.title}>
              {h.earns.body}
            </Tile>
            <Tile icon={ScanFaceIcon} title={h.faceId.title}>
              {h.faceId.body}
            </Tile>
            <Tile icon={LandmarkIcon} title={h.bank.title}>
              {h.bank.body}
            </Tile>
            <Tile dark icon={ScaleIcon} title={h.dispute.title} stat={h.dispute.stat} statLabel={h.dispute.statLabel}>
              {h.dispute.body}
            </Tile>
          </ul>
        </section>

        <section aria-labelledby="sides-title" className="mx-auto max-w-5xl px-4 pb-24">
          <h2 id="sides-title" className="mb-8 text-3xl font-semibold tracking-tight sm:text-4xl">
            {h.sidesTitle}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Side title={h.forLandlords.title} body={h.forLandlords.body} href="/landlord" cta={h.forLandlords.cta} />
            <Side
              title={h.forTenants.title}
              body={h.forTenants.body}
              href="/tenant"
              cta={h.forTenants.cta}
              extra={{ href: "/i/1", label: h.forTenants.invite }}
            />
          </div>
          <p className="mt-10 text-center text-sm text-muted-foreground">{h.disclaimer}</p>
        </section>
      </main>
    </>
  );
}

function Tile(props: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  children: ReactNode;
  dark?: boolean;
  warm?: boolean; // the apricot accent tile
  stat?: string;
  statLabel?: string;
  className?: string;
}) {
  const Icon = props.icon;
  return (
    <li
      className={cn(
        "flex min-h-56 flex-col justify-between gap-6 rounded-3xl p-7",
        props.dark ? "bg-accent text-accent-foreground" : props.warm ? "bg-highlight-soft ring-1 ring-highlight/50" : "bg-card ring-1 ring-foreground/8",
        props.className,
      )}
    >
      <Icon className={cn("size-8", props.warm ? "text-highlight-text" : !props.dark && "text-primary")} aria-hidden />
      <div className="space-y-2">
        {props.stat && (
          <p className="pb-2">
            <span className="block text-5xl font-semibold tracking-tight">{props.stat}</span>
            <span className="block font-medium">{props.statLabel}</span>
          </p>
        )}
        <h3 className="text-2xl font-semibold tracking-tight text-balance">{props.title}</h3>
        <p className={props.dark ? "text-accent-foreground/85" : "text-muted-foreground"}>{props.children}</p>
      </div>
    </li>
  );
}

function Side(props: { title: string; body: string; href: string; cta: string; extra?: { href: string; label: string } }) {
  return (
    <div className="flex flex-col gap-4 rounded-3xl bg-card p-8 ring-1 ring-foreground/8">
      <h3 className="text-3xl font-semibold tracking-tight">{props.title}</h3>
      <p className="text-muted-foreground">{props.body}</p>
      <div className="mt-auto flex flex-wrap gap-x-6">
        <TextLink href={props.href}>{props.cta}</TextLink>
        {props.extra && <TextLink href={props.extra.href}>{props.extra.label}</TextLink>}
      </div>
    </div>
  );
}

// Apple-style text link: blue label with a chevron, 44px tall.
function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-0.5 rounded-md font-medium text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {children}
      <ChevronRightIcon className="size-4" aria-hidden />
    </Link>
  );
}
