import { Skeleton } from "@/components/ui/skeleton";

// Loading state of the detail pane; the sidebar and the list stay on screen.
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 lg:px-8">
      <Skeleton className="mx-auto h-14 w-56" />
      <Skeleton className="h-40 rounded-2xl" />
      <Skeleton className="h-56 rounded-2xl" />
    </div>
  );
}
