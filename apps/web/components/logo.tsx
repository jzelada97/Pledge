"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

// The Pledge logo: a teal "p" with a keyhole cut out, followed by "ledge" in Montserrat Bold. The wordmark
// takes the current text colour, so it works on light, dark and the Wallet passes. `mark` draws the "p" only.
export function Logo({ mark, className }: { mark?: boolean; className?: string }) {
  const keyhole = useId(); // one mask per instance: ids must be unique on the page
  return (
    <svg
      viewBox={mark ? "80 222 182 260" : "80 176 975 306"}
      role="img"
      aria-label="Pledge"
      className={cn(mark ? "h-8 w-auto" : "h-7 w-auto", className)}
    >
      <defs>
        <mask id={keyhole}>
          <rect x="0" y="0" width="1024" height="558" fill="white" />
          <circle cx="171" cy="285" r="25" fill="black" />
          <path d="M 159 298 L 183 298 L 193 356 C 194 360 191 363 187 363 L 155 363 C 151 363 148 360 149 356 Z" fill="black" />
        </mask>
      </defs>
      <g mask={`url(#${keyhole})`} className="fill-(--brand)">
        <path d="M 88 313 L 126 313 L 126 458 C 126 467 119 474 110 474 L 104 474 C 95 474 88 467 88 458 Z" />
        <circle cx="171" cy="313" r="83" />
      </g>
      {!mark && (
        <text
          x="259"
          y="388"
          fill="currentColor"
          style={{ fontFamily: "var(--font-logo), Montserrat, 'Helvetica Neue', Arial, sans-serif", fontWeight: 700, fontSize: 272, letterSpacing: -4 }}
        >
          ledge
        </text>
      )}
    </svg>
  );
}
