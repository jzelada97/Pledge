"use client";

import { LanguagesIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Popover, ToggleGroup } from "radix-ui";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LOCALES, LOCALE_NAME, type Locale } from "@/lib/i18n/config";
import { useI18n, useSetLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

// One button in every header: appearance (automatic, light, dark) and language, as Apple-style
// segmented controls in a popover.
export function PreferencesMenu({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const setLocale = useSetLocale();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []); // the theme is only known in the browser

  const themes = [
    { value: "system", label: t.prefs.system, icon: MonitorIcon },
    { value: "light", label: t.prefs.light, icon: SunIcon },
    { value: "dark", label: t.prefs.dark, icon: MoonIcon },
  ];

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={t.prefs.open} className={className}>
          <LanguagesIcon aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-72 space-y-4 rounded-2xl bg-popover p-4 text-popover-foreground shadow-2xl ring-1 ring-foreground/10 data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <Segment
            label={t.prefs.appearance}
            value={mounted ? (theme ?? "system") : ""}
            onChange={setTheme}
            options={themes.map((o) => ({ value: o.value, label: o.label, icon: o.icon }))}
          />
          <Segment
            label={t.prefs.language}
            value={locale}
            onChange={(v) => setLocale(v as Locale)}
            options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAME[l], lang: l }))}
            stacked
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Segment(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; icon?: React.ComponentType<{ className?: string }>; lang?: string }[];
  stacked?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">{props.label}</p>
      <ToggleGroup.Root
        type="single"
        aria-label={props.label}
        value={props.value}
        onValueChange={(v) => v && props.onChange(v)}
        className={cn("grid gap-1 rounded-xl bg-muted p-1", props.stacked ? "grid-cols-1" : "grid-cols-3")}
      >
        {props.options.map((o) => (
          <ToggleGroup.Item
            key={o.value}
            value={o.value}
            lang={o.lang}
            className={cn(
              "flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              props.stacked ? "justify-start px-3" : "flex-col justify-center gap-0.5 py-1.5 text-xs",
              "data-[state=on]:bg-card data-[state=on]:font-semibold data-[state=on]:shadow-sm data-[state=on]:ring-1 data-[state=on]:ring-foreground/10",
            )}
          >
            {o.icon && <o.icon className="size-4" aria-hidden />}
            {o.label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
    </div>
  );
}
