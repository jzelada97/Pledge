import { ChevronRightIcon, LandmarkIcon, ScaleIcon, ScanFaceIcon, ShieldCheckIcon, SproutIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DepositPass } from "@/components/deposit-pass";
import { NavLink, SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { CONFIG } from "@/lib/fixtures";
import { DAY } from "@/lib/format";
import { cn } from "@/lib/utils";

const timeoutDays = Number(CONFIG.timeout_secs / DAY);
const reviewDays = Number(CONFIG.review_timeout_secs / DAY);

// apple.com-style product page: centred headline and two pill actions, the product (a deposit pass) as the
// hero image, a bento grid of facts, then one panel per side of the deposit.
export default function Home() {
  return (
    <>
      <SiteHeader
        nav={
          <>
            <NavLink href="/landlord">Landlords</NavLink>
            <NavLink href="/tenant">Tenants</NavLink>
          </>
        }
      />
      <main className="overflow-x-clip">
        <section className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 pt-14 text-center sm:pt-20">
          <h1 className="text-5xl font-semibold tracking-tight text-balance sm:text-7xl">Room deposits that come back in full.</h1>
          <p className="max-w-2xl text-lg text-muted-foreground sm:text-xl">
            Fianzas holds your tenant&apos;s deposit until the contract ends. When you both approve, it goes back with one tap
            from each side.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/landlord">I&apos;m a landlord</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/tenant">I&apos;m a tenant</Link>
            </Button>
          </div>

          {/* The product shot: a tilted pass over a soft tonal glow */}
          <figure className="relative mt-10 w-full max-w-sm pb-4 sm:mt-14">
            <div aria-hidden className="absolute inset-x-6 top-10 bottom-0 rounded-full bg-primary/20 blur-3xl" />
            <DepositPass
              id="2"
              amount="$1,200.00"
              status="Active"
              note="Back to you in full"
              facts={[
                { label: "Contract ends", value: "Aug 26, 2027" },
                { label: "Yield", value: "Variable" },
              ]}
              className="relative -rotate-3 text-left"
            />
            <figcaption className="mt-6 text-sm text-muted-foreground">Example deposit, as your tenant sees it</figcaption>
          </figure>
        </section>

        <section aria-labelledby="facts-title" className="mx-auto max-w-5xl px-4 py-20">
          <h2 id="facts-title" className="mb-8 text-3xl font-semibold tracking-tight sm:text-4xl">
            Simple for both of you.
          </h2>
          <ul className="grid gap-4 sm:grid-cols-3">
            <Tile dark className="sm:col-span-2" icon={ShieldCheckIcon} title="Returned in full.">
              When the landlord and the tenant both approve, the whole deposit goes back to the tenant. The deposit never pays
              fees.
            </Tile>
            <Tile icon={SproutIcon} title="Earns while it waits.">
              The deposit earns a variable yield while it&apos;s held. Only that yield is split, and it can be lower, or zero.
            </Tile>
            <Tile icon={ScanFaceIcon} title="Face ID. No app.">
              Tenants sign in with Face ID and pay no fees. Nothing to install.
            </Tile>
            <Tile icon={LandmarkIcon} title="Straight from the bank.">
              Tenants pay from their bank account and get the money back there.
            </Tile>
            <Tile dark icon={ScaleIcon} title="Fair if there's a dispute." stat={`${reviewDays} days`} statLabel="for the staff to decide">
              Only the landlord can stop a release, and it costs a good-faith deposit. An independent expert reviews it.
            </Tile>
          </ul>
        </section>

        <section aria-labelledby="sides-title" className="mx-auto max-w-5xl px-4 pb-24">
          <h2 id="sides-title" className="mb-8 text-3xl font-semibold tracking-tight sm:text-4xl">
            Two sides. One deposit.
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Side
              title="For landlords"
              body="Create a deposit, send the invitation link and approve the release when the contract ends. Every deposit and what it needs from you, in one place."
              href="/landlord"
              cta="Go to my deposits"
            />
            <Side
              title="For tenants"
              body={`Pay from your bank and see when your deposit comes back. If your landlord doesn't respond within ${timeoutDays} days after the contract ends, you can claim it.`}
              href="/tenant"
              cta="See my deposits"
              extra={{ href: "/i/1", label: "Open an invitation" }}
            />
          </div>
          <p className="mt-10 text-center text-sm text-muted-foreground">
            The yield is variable and never guaranteed. No option is free of risk.
          </p>
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
  stat?: string;
  statLabel?: string;
  className?: string;
}) {
  const Icon = props.icon;
  return (
    <li
      className={cn(
        "flex min-h-56 flex-col justify-between gap-6 rounded-3xl p-7",
        props.dark ? "bg-accent text-accent-foreground" : "bg-card ring-1 ring-foreground/8",
        props.className,
      )}
    >
      <Icon className={cn("size-8", !props.dark && "text-primary")} aria-hidden />
      <div className="space-y-2">
        {props.stat && (
          <p className="pb-2">
            <span className="block text-5xl font-semibold tracking-tight">{props.stat}</span>
            <span className="block font-medium">{props.statLabel}</span>
          </p>
        )}
        <h3 className="text-2xl font-semibold tracking-tight">{props.title}</h3>
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
