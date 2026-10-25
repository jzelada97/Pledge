import { ArrowRightIcon, BuildingIcon, KeyRoundIcon, LandmarkIcon, ShieldCheckIcon, SproutIcon } from "lucide-react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

const POINTS = [
  { icon: ShieldCheckIcon, title: "Returned in full", body: "When the landlord and the tenant both approve, the whole deposit goes back to the tenant." },
  { icon: SproutIcon, title: "Earns while it waits", body: "The deposit earns a variable yield while it is held. Only that yield is split." },
  { icon: LandmarkIcon, title: "Fair if there's a dispute", body: "An independent expert reviews any stop. If nobody responds in time, the tenant gets it back." },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-12 sm:px-6 sm:py-16">
        <section className="max-w-2xl space-y-4">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Room deposits that come back in full
          </h1>
          <p className="text-lg text-muted-foreground">
            Fianzas holds your tenant&apos;s deposit until the contract ends. When you both approve, it goes back with one
            tap from each side.
          </p>
        </section>

        <section aria-labelledby="choose-role" className="space-y-4">
          <h2 id="choose-role" className="sr-only">
            Choose how you use Fianzas
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <BuildingIcon className="size-6 text-primary" aria-hidden />
                <CardTitle className="text-xl">I&apos;m a landlord</CardTitle>
                <CardDescription>Create deposits, send invitations and approve releases.</CardDescription>
              </CardHeader>
              <CardFooter className="justify-end">
                <Button asChild>
                  <Link href="/landlord">
                    Go to my deposits
                    <ArrowRightIcon data-icon="inline-end" aria-hidden />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <KeyRoundIcon className="size-6 text-primary" aria-hidden />
                <CardTitle className="text-xl">I&apos;m a tenant</CardTitle>
                <CardDescription>Pay your deposit from your bank and see when it comes back.</CardDescription>
              </CardHeader>
              <CardFooter className="justify-end gap-2">
                <Button asChild variant="outline">
                  <Link href="/i/1">Open my invitation</Link>
                </Button>
                <Button asChild>
                  <Link href="/tenant">
                    My deposits
                    <ArrowRightIcon data-icon="inline-end" aria-hidden />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          </div>
        </section>

        <section aria-labelledby="how-it-works" className="space-y-4">
          <h2 id="how-it-works" className="text-xl font-semibold tracking-tight">
            How it works
          </h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {POINTS.map((p) => (
              <li key={p.title}>
                <Card className="h-full">
                  <CardContent className="space-y-2">
                    <p.icon className="size-5 text-primary" aria-hidden />
                    <h3 className="font-semibold">{p.title}</h3>
                    <p className="text-sm text-muted-foreground">{p.body}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
