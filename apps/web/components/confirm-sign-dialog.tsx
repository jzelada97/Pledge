"use client";

import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useSign } from "@/lib/use-sign";

// Destructive action: variant="destructive" trigger + AlertDialog confirmation before signing.
export function ConfirmSignDialog(props: {
  trigger: string;
  title: string;
  description: ReactNode;
  confirm: string;
  cancel: string;
  success: string;
}) {
  const { phase, run, busy, phaseText } = useSign({ success: props.success });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={busy || phase === "done"} aria-busy={busy}>
          {busy && <Spinner data-icon="inline-start" aria-hidden />}
          {busy || phase === "done" ? phaseText : props.trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{props.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={run}>
            {props.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
