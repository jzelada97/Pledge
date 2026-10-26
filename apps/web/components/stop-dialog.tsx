"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { OctagonPauseIcon } from "lucide-react";
import { useMemo, useState } from "react";
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
import { useI18n } from "@/lib/i18n/client";
import { useSign } from "@/lib/use-sign";

const schemaFor = (t: { reasonMin: string; reasonMax: string }) =>
  z.object({ reason: z.string().trim().min(10, t.reasonMin).max(1000, t.reasonMax) });

// Stop release (plan A, Trustless Work): opens a dispute. There's no good-faith deposit; the staff decides.
export function StopDialog({ action, onDone }: { action?: () => Promise<unknown>; onDone?: () => void } = {}) {
  const { t } = useI18n();
  const s = t.landlord.stop;
  const schema = useMemo(() => schemaFor(s), [s]);
  const [open, setOpen] = useState(false);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { reason: "" } });
  const { phase, run, busy, phaseText } = useSign({ success: s.success, action, onDone });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={busy || phase === "done"} aria-busy={busy}>
          {busy && <Spinner data-icon="inline-start" aria-hidden />}
          {busy ? phaseText : phase === "done" ? s.done : s.trigger}
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
              <AlertDialogTitle>{s.title}</AlertDialogTitle>
              <AlertDialogDescription>{s.rule}</AlertDialogDescription>
            </AlertDialogHeader>
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{s.reason}</FormLabel>
                  <FormControl>
                    <Textarea rows={4} placeholder={s.placeholder} {...field} />
                  </FormControl>
                  <FormDescription>{s.hint}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DevNote>reason_hash = sha256(salt ‖ reason) (DAT-2); the text and the salt stay off-chain.</DevNote>
            <AlertDialogFooter>
              <AlertDialogCancel type="button">{s.keep}</AlertDialogCancel>
              <Button type="submit" variant="destructive">
                {s.confirm}
              </Button>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
