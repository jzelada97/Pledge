"use client";

import { OctagonXIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16">
      <Alert variant="destructive">
        <OctagonXIcon aria-hidden />
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>We couldn&apos;t load this page. Check your connection and try again.</AlertDescription>
      </Alert>
      <div className="flex justify-end">
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
