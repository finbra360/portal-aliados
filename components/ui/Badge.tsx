import type { ReactNode } from "react";

type Variant = "purple" | "gray" | "success" | "warning" | "draft";

const VARIANT_CLASSES: Record<Variant, string> = {
  purple: "bg-finbra-purple/10 text-finbra-purple",
  gray: "bg-black/5 text-finbra-gray",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-800",
  draft: "bg-finbra-lilac/40 text-finbra-purple",
};

export default function Badge({
  children,
  variant = "purple",
  className = "",
}: {
  children: ReactNode;
  variant?: Variant;
  className?: string;
}) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
