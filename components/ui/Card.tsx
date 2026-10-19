import type { ReactNode } from "react";

export default function Card({
  children,
  className = "",
  highlight = false,
  tabIndex,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  highlight?: boolean;
  /** 0 para tarjetas con scroll propio: así se pueden desplazar con el teclado. */
  tabIndex?: 0;
  "aria-label"?: string;
}) {
  return (
    <div
      tabIndex={tabIndex}
      role={tabIndex === 0 && ariaLabel ? "region" : undefined}
      aria-label={ariaLabel}
      className={`rounded-xl border bg-white p-6 shadow-[0_2px_12px_rgba(93,91,219,0.12)] ${
        highlight ? "border-finbra-purple/30" : "border-finbra-purple/10"
      } ${className}`}
    >
      {children}
    </div>
  );
}
