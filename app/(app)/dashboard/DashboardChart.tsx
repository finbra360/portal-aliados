"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PorMes } from "@/lib/n8n";
import { aggregatePorMes, type ChartPeriod } from "@/lib/chart-aggregation";
import { formatCurrency } from "@/lib/format";

const PERIODS: { id: ChartPeriod; label: string }[] = [
  { id: "mes", label: "Mes" },
  { id: "trimestre", label: "Trimestre" },
  { id: "anio", label: "Año" },
];

const formatTooltipValue = (value: unknown) => formatCurrency(Number(value) || 0);

export default function DashboardChart({ data }: { data: PorMes[] }) {
  const [period, setPeriod] = useState<ChartPeriod>("mes");
  const points = useMemo(() => aggregatePorMes(data, period), [data, period]);

  if (!data.length) {
    return <p className="text-sm text-finbra-gray">Todavía no hay datos de colocación.</p>;
  }

  return (
    <div>
      <div className="mb-4 flex justify-end gap-1">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPeriod(p.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              period === p.id ? "bg-finbra-purple text-white" : "bg-finbra-purple/10 text-finbra-purple"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="#00000010" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#5d5d5d" }} />
            <YAxis tick={{ fontSize: 12, fill: "#5d5d5d" }} />
            <Tooltip formatter={formatTooltipValue} />
            <Bar dataKey="monto" fill="#5d5bdb" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
