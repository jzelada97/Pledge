import { TenantShell } from "@/components/tenant-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <TenantShell>
      <div role="status" aria-label="Loading your deposits" className="flex flex-col gap-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-6 w-full" />
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-56 rounded-xl" />
        ))}
      </div>
    </TenantShell>
  );
}
