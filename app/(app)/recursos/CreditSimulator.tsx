"use client";

import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

function calcularPagoMensual(monto: number, tasaAnualPct: number, plazoMeses: number): number {
  const r = tasaAnualPct / 100 / 12;
  if (r === 0) return monto / plazoMeses;
  return (monto * r) / (1 - Math.pow(1 + r, -plazoMeses));
}

export default function CreditSimulator() {
  const [monto, setMonto] = useState(1_000_000);
  const [plazoMeses, setPlazoMeses] = useState(24);
  const [tasaAnual, setTasaAnual] = useState(24);

  const pagoMensual = useMemo(() => calcularPagoMensual(monto, tasaAnual, plazoMeses), [monto, tasaAnual, plazoMeses]);
  const totalPagado = pagoMensual * plazoMeses;

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold">Simulador de crédito</p>
        <Badge variant="draft">Ilustrativo</Badge>
      </div>
      <p className="mb-4 text-xs text-finbra-gray">
        Cálculo de referencia con tasa ajustable — no es una tasa ni condición oficial de Finbra.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm">
          Monto (MXN)
          <input
            type="number"
            min={500000}
            max={5000000}
            step={50000}
            value={monto}
            onChange={(e) => setMonto(Number(e.target.value) || 0)}
            className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 outline-none focus:border-finbra-purple"
          />
        </label>
        <label className="text-sm">
          Plazo (meses)
          <input
            type="number"
            min={6}
            max={60}
            value={plazoMeses}
            onChange={(e) => setPlazoMeses(Number(e.target.value) || 1)}
            className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 outline-none focus:border-finbra-purple"
          />
        </label>
        <label className="text-sm">
          Tasa anual estimada (%)
          <input
            type="number"
            min={1}
            max={80}
            value={tasaAnual}
            onChange={(e) => setTasaAnual(Number(e.target.value) || 1)}
            className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 outline-none focus:border-finbra-purple"
          />
        </label>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg bg-finbra-purple/5 p-4">
          <p className="text-xs text-finbra-gray">Pago mensual estimado</p>
          <p className="text-xl font-bold text-finbra-purple">{formatCurrency(pagoMensual)}</p>
        </div>
        <div className="rounded-lg bg-finbra-purple/5 p-4">
          <p className="text-xs text-finbra-gray">Total a pagar estimado</p>
          <p className="text-xl font-bold text-finbra-purple">{formatCurrency(totalPagado)}</p>
        </div>
      </div>
    </Card>
  );
}
