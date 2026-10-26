"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n/client";

export function InviteLink({ url }: { url: string }) {
  const { t } = useI18n();
  const c = t.landlord.invite;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(c.copied);
    } catch {
      toast.error(c.copyFailedManual);
    }
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor="invite-link">{c.label}</Label>
      <div className="flex gap-2">
        <Input id="invite-link" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
        <Button type="button" variant="outline" onClick={copy} aria-label={t.landlord.detail.copyInvite}>
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          {copied ? c.copiedShort : c.copy}
        </Button>
      </div>
    </div>
  );
}
