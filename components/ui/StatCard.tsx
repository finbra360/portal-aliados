import type { ReactNode } from "react";
import Card from "./Card";
import { formatPercent } from "@/lib/format";

export default function StatCard({
  label,
  value,
  sublabel,
  deltaPct,
  icon,
}: {
  label: string;
  value: string;
  sublabel?: string;
  deltaPct?: number | null;
  icon?: ReactNode;
}) {
  const hasDelta = typeof deltaPct === "number" && Number.isFinite(deltaPct);
  const deltaPositive = hasDelta && (deltaPct as number) >= 0;

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-finbra-gray">{label}</p>
        {icon && <div className="text-finbra-purple/60">{icon}</div>}
      </div>
      <p className="mt-1 text-3xl font-bold text-finbra-purple">{value}</p>
      <div className="mt-2 flex items-center gap-2 text-xs text-finbra-gray">
        {sublabel && <span>{sublabel}</span>}
        {hasDelta && (
          <span
            className={`rounded-full px-2 py-0.5 font-semibold ${
              deltaPositive ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
            }`}
          >
            {formatPercent(deltaPct as number)} vs. mes anterior
          </span>
        )}
      </div>
    </Card>
  );
}
