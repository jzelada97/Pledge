import { CodeIcon } from "lucide-react";
import type { ReactNode } from "react";

// Implementation notes for the team (data sources, security rules). Hidden unless NEXT_PUBLIC_SHOW_NOTES=1,
// so they never show in the demo.
export function DevNote({ children }: { children: ReactNode }) {
  if (process.env.NEXT_PUBLIC_SHOW_NOTES !== "1") return null;
  return (
    <p className="flex items-start gap-2 rounded-lg border border-dashed border-ring bg-accent px-3 py-2 text-xs text-accent-foreground">
      <CodeIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
