import type { ReactNode } from "react";

export default function Card({
  children,
  className = "",
  highlight = false,
}: {
  children: ReactNode;
  className?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-6 shadow-[0_2px_12px_rgba(93,91,219,0.12)] ${
        highlight ? "border-finbra-purple/30" : "border-finbra-purple/10"
      } ${className}`}
    >
      {children}
    </div>
  );
}
