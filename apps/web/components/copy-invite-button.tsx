"use client";

import { LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyInviteButton({ id }: { id: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/i/${id}#c=example-invitation-code`);
      toast.success("Invitation link copied");
    } catch {
      toast.error("We couldn't copy the link. Try again.");
    }
  }
  return (
    <Button onClick={copy}>
      <LinkIcon data-icon="inline-start" aria-hidden />
      Copy invitation link
    </Button>
  );
}
