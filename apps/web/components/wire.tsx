import Link from "next/link";
import type { ReactNode } from "react";

// Low-fidelity building blocks: grayscale, dashed boxes, blue notes for annotations.

export function Screen(props: { title: string; back?: string; narrow?: boolean; note?: ReactNode; children: ReactNode }) {
  return (
    <main className={`mx-auto flex flex-col gap-4 px-4 py-8 ${props.narrow ? "max-w-sm" : "max-w-5xl"}`}>
      {props.back && (
        <Link href={props.back} className="text-sm text-neutral-500 underline">
          ← Back
        </Link>
      )}
      <h1 className="text-2xl font-semibold">{props.title}</h1>
      {props.note && <Note>{props.note}</Note>}
      {props.children}
    </main>
  );
}

export function Box(props: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded border-2 border-dashed border-neutral-300 p-4">
      {props.title && <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{props.title}</h2>}
      {props.children}
    </section>
  );
}

export function Note(props: { children: ReactNode }) {
  return <p className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-800">{props.children}</p>;
}

export function Tag(props: { children: ReactNode }) {
  return <span className="rounded border border-neutral-400 px-1.5 py-0.5 text-xs text-neutral-700">{props.children}</span>;
}

export function Row(props: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-neutral-500">{props.label}</span>
      <span className="text-right font-medium">{props.value}</span>
    </div>
  );
}

const BTN = "rounded border-2 border-neutral-800 px-3 py-2 text-center text-sm font-medium";

export function LinkBtn(props: { href: string; children: ReactNode; secondary?: boolean }) {
  return (
    <Link href={props.href} className={`${BTN} ${props.secondary ? "bg-white" : "bg-neutral-800 text-white"}`}>
      {props.children}
    </Link>
  );
}

export function Btn(props: { children: ReactNode; secondary?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={`${BTN} ${props.secondary ? "bg-white" : "bg-neutral-800 text-white"} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {props.children}
    </button>
  );
}
