import Link from "next/link";
import { Box, Note, Screen } from "@/components/wire";

const SCREENS = [
  { href: "/landlord", title: "Landlord dashboard", who: "Landlord · desktop" },
  { href: "/landlord/new", title: "Create a deposit", who: "Landlord · desktop" },
  { href: "/landlord/deposits/3", title: "Deposit detail: approve or stop", who: "Landlord · desktop" },
  { href: "/i/1", title: "Invitation: accept and pay", who: "Tenant · mobile" },
  { href: "/i/2", title: "Invitation no longer valid", who: "Tenant · mobile" },
  { href: "/tenant", title: "My deposit", who: "Tenant · mobile" },
];

export default function Home() {
  return (
    <Screen
      title="Fianzas · low-fidelity screens"
      note="Wireframes with fixture data. No real accounts or contracts yet. The staff backoffice runs on port 3001."
    >
      <Box title="Screens">
        <ul className="flex flex-col gap-2">
          {SCREENS.map((s) => (
            <li key={s.href} className="flex justify-between gap-4 text-sm">
              <Link href={s.href} className="font-medium underline">
                {s.title}
              </Link>
              <span className="text-neutral-500">{s.who}</span>
            </li>
          ))}
        </ul>
      </Box>
      <Note>
        When the landlord and the tenant both approve the release, the deposit goes back to the tenant in full. Only the
        variable yield is split.
      </Note>
    </Screen>
  );
}
