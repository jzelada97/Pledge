"use client";

import { OctagonXIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16">
      <Alert variant="destructive">
        <OctagonXIcon aria-hidden />
        <AlertTitle>{t.errors.title}</AlertTitle>
        <AlertDescription>{t.errors.body}</AlertDescription>
      </Alert>
      <div className="flex justify-end">
        <Button onClick={reset}>{t.errors.tryAgain}</Button>
      </div>
    </main>
  );
}
