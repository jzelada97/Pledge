"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { OctagonPauseIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { DevNote } from "@/components/dev-note";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { money } from "@/lib/format";
import { PHASE_TEXT, useSign } from "@/lib/use-sign";

const schema = z.object({
  reason: z.string().trim().min(10, "Explain the reason in at least 10 characters.").max(1000, "Keep it under 1,000 characters."),
});

// Stop release: before signing, show what the good-faith deposit costs and the rule for getting it back.
export function StopDialog({ bond }: { bond: bigint }) {
  const [open, setOpen] = useState(false);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { reason: "" } });
  const { phase, run, busy } = useSign({ success: "Release stopped. The staff will assign an expert." });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={busy || phase === "done"} aria-busy={busy}>
          {busy && <Spinner data-icon="inline-start" aria-hidden />}
          {busy ? PHASE_TEXT[phase as "signing" | "sending"] : phase === "done" ? "Release stopped" : "Stop release"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <Form {...form}>
          <form
            className="grid gap-4"
            onSubmit={form.handleSubmit(() => {
              setOpen(false);
              run();
            })}
          >
            <AlertDialogHeader>
              <AlertDialogMedia className="bg-destructive/10 text-destructive">
                <OctagonPauseIcon aria-hidden />
              </AlertDialogMedia>
              <AlertDialogTitle>Stop the release?</AlertDialogTitle>
              <AlertDialogDescription>
                Stopping costs a good-faith deposit of <strong className="text-foreground">{money(bond)}</strong>. If the
                expert agrees with you, you get it back. If not, it goes to pay the expert.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Why are you stopping the release?</FormLabel>
                  <FormControl>
                    <Textarea rows={4} placeholder="For example: damage to the desk and the window" {...field} />
                  </FormControl>
                  <FormDescription>Only a private fingerprint of your reason is recorded.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DevNote>reason_hash = sha256(salt ‖ reason) (DAT-2); the text and the salt stay off-chain.</DevNote>
            <AlertDialogFooter>
              <AlertDialogCancel type="button">Keep the release</AlertDialogCancel>
              <Button type="submit" variant="destructive">
                Pay {money(bond)} and stop
              </Button>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
