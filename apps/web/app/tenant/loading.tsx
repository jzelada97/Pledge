import { TenantShell } from "@/components/tenant-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <TenantShell>
      <div role="status" aria-label="Loading your deposits" className="flex flex-col gap-5">
        <Skeleton className="h-10 w-48" />
        {[0, 1].map((i) => (
          <Skeleton key={i} className="aspect-[1.586] rounded-[1.25rem]" />
        ))}
      </div>
    </TenantShell>
  );
}
