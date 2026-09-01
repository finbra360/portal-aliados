"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PorMes } from "@/lib/n8n";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(value);

export default function DashboardChart({ data }: { data: PorMes[] }) {
  if (!data.length) {
    return <p className="text-sm text-finbra-gray">Todavía no hay datos de colocación este año.</p>;
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#00000010" />
          <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "#5d5d5d" }} />
          <YAxis tick={{ fontSize: 12, fill: "#5d5d5d" }} />
          <Tooltip formatter={(value: number) => formatCurrency(value)} />
          <Bar dataKey="monto" fill="#5d5bdb" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
