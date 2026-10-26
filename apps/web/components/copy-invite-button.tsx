"use client";

import { LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

export function CopyInviteButton({ id }: { id: string }) {
  const { t } = useI18n();
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/i/${id}#c=example-invitation-code`);
      toast.success(t.landlord.invite.copied);
    } catch {
      toast.error(t.landlord.invite.copyFailed);
    }
  }
  return (
    <Button onClick={copy}>
      <LinkIcon data-icon="inline-start" aria-hidden />
      {t.landlord.detail.copyInvite}
    </Button>
  );
}
