"use client";

import { useActionState, useState } from "react";
import { REGLAS, type AccionRegla, type PoliticaCH } from "@/lib/credit-health/politica-tipos";
import { guardarPoliticaAction, type EstadoPolitica } from "../actions";

const ACCIONES: Array<{ v: AccionRegla; l: string }> = [
  { v: "exclude", l: "Excluir" },
  { v: "review", l: "Revisión" },
  { v: "ignore", l: "Ignorar" },
];

/** Marcas de «pendiente» de la política de referencia, para volver a ponerlas si se desmarca la aprobación. */
const PENDIENTES_REFERENCIA = [
  "product.annualRate",
  "product.minAmount",
  "product.maxAmount",
  "product.minTermMonths",
  "product.maxTermMonths",
  "capacity.minDscr",
  "capacity.stressSalesDropPct",
  "capacity.operatingCashBufferMonths",
  "eligibility.minAnnualRevenue",
  "eligibility.minMonthsOperating",
  "eligibility.collateral",
  "eligibility.bureau",
  "eligibility.restrictedIndustries",
  "eligibility.customerConcentrationReviewPct",
  "eligibility.declaredVsHistoryReviewPct",
  "scoring.weights",
  "priority",
  "retention",
];

const campo = "h-10 w-full rounded-lg border border-black/10 bg-white px-3 text-sm tabular-nums focus:border-finbra-purple focus:outline-none disabled:bg-black/5";
const redondear = (v: number) => Math.round(v * 1000) / 1000;

export default function EditorPolitica({ inicial, puedeEditar }: { inicial: PoliticaCH; puedeEditar: boolean }) {
  const [p, setP] = useState<PoliticaCH>(() => structuredClone(inicial));
  const [notas, setNotas] = useState("");
  const [estado, accion, enviando] = useActionState<EstadoPolitica, FormData>(guardarPoliticaAction, { ok: false, mensaje: null });
  const set = (fn: (d: PoliticaCH) => void) =>
    setP((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  const pendiente = (clave: string) => p.pendingApproval.some((k) => clave.startsWith(k) || k.startsWith(clave));

  return (
    <form action={accion} className="space-y-6">
      <input type="hidden" name="config" value={JSON.stringify(p)} />
      <input type="hidden" name="notas" value={notas} />
      <fieldset disabled={!puedeEditar} className="space-y-6">
        <Campo etiqueta="Nombre de la versión">
          <input value={p.label} maxLength={80} onChange={(e) => set((d) => void (d.label = e.target.value))} className={campo} />
        </Campo>

        <Grupo titulo="Producto">
          <Numero etiqueta="Monto mínimo (MXN)" valor={p.product.minAmount} pendiente={pendiente("product.minAmount")} onChange={(v) => set((d) => void (d.product.minAmount = v))} />
          <Numero etiqueta="Monto máximo (MXN)" valor={p.product.maxAmount} pendiente={pendiente("product.maxAmount")} onChange={(v) => set((d) => void (d.product.maxAmount = v))} />
          <Numero etiqueta="Plazo mínimo (meses)" valor={p.product.minTermMonths} pendiente={pendiente("product.minTermMonths")} onChange={(v) => set((d) => void (d.product.minTermMonths = v))} />
          <Numero etiqueta="Plazo máximo (meses)" valor={p.product.maxTermMonths} pendiente={pendiente("product.maxTermMonths")} onChange={(v) => set((d) => void (d.product.maxTermMonths = v))} />
          <Numero etiqueta="Tasa anual de referencia (%)" valor={redondear(p.product.annualRate * 100)} paso={0.1} pendiente={pendiente("product.annualRate")} onChange={(v) => set((d) => void (d.product.annualRate = v / 100))} />
          <Numero etiqueta="IVA sobre intereses (%)" valor={redondear(p.product.vatRate * 100)} pendiente={false} onChange={(v) => set((d) => void (d.product.vatRate = v / 100))} />
        </Grupo>

        <Grupo titulo="Capacidad de pago">
          <Numero etiqueta="DSCR mínimo (x)" valor={p.capacity.minDscr} paso={0.05} pendiente={pendiente("capacity.minDscr")} onChange={(v) => set((d) => void (d.capacity.minDscr = v))} />
          <Numero etiqueta="Estrés de ventas para el rango (%)" valor={redondear(p.capacity.stressSalesDropPct * 100)} pendiente={pendiente("capacity.stressSalesDropPct")} onChange={(v) => set((d) => void (d.capacity.stressSalesDropPct = v / 100))} />
          <Numero etiqueta="Colchón operativo (meses)" valor={p.capacity.operatingCashBufferMonths} paso={0.5} pendiente={pendiente("capacity.operatingCashBufferMonths")} onChange={(v) => set((d) => void (d.capacity.operatingCashBufferMonths = v))} />
        </Grupo>

        <Grupo titulo="Elegibilidad">
          <Numero etiqueta="Ingresos anuales mínimos (MXN)" valor={p.eligibility.minAnnualRevenue} pendiente={pendiente("eligibility.minAnnualRevenue")} onChange={(v) => set((d) => void (d.eligibility.minAnnualRevenue = v))} />
          <Numero etiqueta="Antigüedad mínima (meses)" valor={p.eligibility.minMonthsOperating} pendiente={pendiente("eligibility.minMonthsOperating")} onChange={(v) => set((d) => void (d.eligibility.minMonthsOperating = v))} />
          <Numero etiqueta="Cobertura vehicular (x:1)" valor={p.eligibility.collateral.vehicular.coverageRatio} paso={0.1} pendiente={pendiente("eligibility.collateral")} onChange={(v) => set((d) => void (d.eligibility.collateral.vehicular.coverageRatio = v))} />
          <Numero etiqueta="Cobertura inmobiliaria (x:1)" valor={p.eligibility.collateral.inmobiliaria.coverageRatio} paso={0.1} pendiente={pendiente("eligibility.collateral")} onChange={(v) => set((d) => void (d.eligibility.collateral.inmobiliaria.coverageRatio = v))} />
          <Numero etiqueta="Concentración que activa revisión (%)" valor={p.eligibility.customerConcentrationReviewPct} pendiente={pendiente("eligibility.customerConcentrationReviewPct")} onChange={(v) => set((d) => void (d.eligibility.customerConcentrationReviewPct = v))} />
          <Numero etiqueta="Diferencia declarada vs historial (%)" valor={p.eligibility.declaredVsHistoryReviewPct} pendiente={pendiente("eligibility.declaredVsHistoryReviewPct")} onChange={(v) => set((d) => void (d.eligibility.declaredVsHistoryReviewPct = v))} />
        </Grupo>

        <Grupo titulo="Buró de Crédito (interpretación del historial declarado)" columnas={2}>
          <Numero etiqueta="MOP máximo aceptado" valor={p.eligibility.bureau.maxMop} pendiente={pendiente("eligibility.bureau")} onChange={(v) => set((d) => void (d.eligibility.bureau.maxMop = v))} />
          <Numero etiqueta="Periodo considerado (meses)" valor={p.eligibility.bureau.lookbackMonths} pendiente={pendiente("eligibility.bureau")} onChange={(v) => set((d) => void (d.eligibility.bureau.lookbackMonths = v))} />
          <Campo etiqueta="Si no conoce su historial">
            <SelectorAccion valor={p.eligibility.bureau.unknownTreatment} onChange={(v) => set((d) => void (d.eligibility.bureau.unknownTreatment = v))} />
          </Campo>
          <Campo etiqueta="Si nunca ha tenido créditos">
            <SelectorAccion valor={p.eligibility.bureau.noHistoryTreatment} onChange={(v) => set((d) => void (d.eligibility.bureau.noHistoryTreatment = v))} />
          </Campo>
          <Campo etiqueta="Productos considerados (uno por línea)" className="sm:col-span-2">
            <textarea
              value={p.eligibility.bureau.productsConsidered.join("\n")}
              onChange={(e) => set((d) => void (d.eligibility.bureau.productsConsidered = e.target.value.split("\n").map((x) => x.trim()).filter(Boolean)))}
              className="min-h-20 w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:border-finbra-purple focus:outline-none"
            />
          </Campo>
          <Campo etiqueta="Excepciones" className="sm:col-span-2">
            <textarea
              value={p.eligibility.bureau.exceptions}
              maxLength={1000}
              onChange={(e) => set((d) => void (d.eligibility.bureau.exceptions = e.target.value))}
              className="min-h-20 w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:border-finbra-purple focus:outline-none"
            />
          </Campo>
        </Grupo>

        <div>
          <Titulo texto="Actividades restringidas (SCIAN)" pendiente={pendiente("eligibility.restrictedIndustries")} />
          <p className="mb-3 text-xs text-finbra-gray">
            Solo las marcadas como <strong>confirmadas</strong> excluyen; las demás mandan el caso a revisión. No agregues actividades sin una política aprobada.
          </p>
          <div className="space-y-2">
            {p.eligibility.restrictedIndustries.map((r, i) => (
              <div key={i} className="grid grid-cols-[90px_1fr_auto_auto] items-center gap-2 rounded-lg border border-black/10 bg-white p-2">
                <input aria-label="Código SCIAN" value={r.code} maxLength={6} inputMode="numeric" className={campo} onChange={(e) => set((d) => void (d.eligibility.restrictedIndustries[i].code = e.target.value.replace(/\D/g, "")))} />
                <input aria-label="Actividad" value={r.label} className={campo} onChange={(e) => set((d) => void (d.eligibility.restrictedIndustries[i].label = e.target.value))} />
                <label className="flex items-center gap-1.5 text-xs font-semibold">
                  <input type="checkbox" checked={r.confirmed} onChange={(e) => set((d) => void (d.eligibility.restrictedIndustries[i].confirmed = e.target.checked))} className="size-4 accent-[#5d5bdb]" />
                  Confirmada
                </label>
                <button type="button" onClick={() => set((d) => void d.eligibility.restrictedIndustries.splice(i, 1))} className="rounded-lg px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">
                  Quitar
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => set((d) => void d.eligibility.restrictedIndustries.push({ code: "", label: "", reason: "", confirmed: false }))}
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-semibold hover:border-finbra-purple/40"
            >
              + Agregar actividad
            </button>
          </div>
        </div>

        <div>
          <Titulo texto="Qué hace cada regla" />
          <div className="grid gap-2 sm:grid-cols-2">
            {REGLAS.map(([id, nombre]) => (
              <div key={id} className="flex items-center justify-between gap-3 rounded-lg border border-black/10 bg-white px-3 py-2">
                <span className="text-sm">{nombre}</span>
                <SelectorAccion valor={p.rules[id] ?? "review"} onChange={(v) => set((d) => void (d.rules[id] = v))} />
              </div>
            ))}
          </div>
        </div>

        <Grupo titulo="Prioridad comercial y conservación de datos">
          <Numero etiqueta="Monto mínimo para alta prioridad" valor={p.priority.highPriorityMinAmount} pendiente={pendiente("priority")} onChange={(v) => set((d) => void (d.priority.highPriorityMinAmount = v))} />
          <Numero etiqueta="Score mínimo para alta prioridad" valor={p.priority.highPriorityMinScore} pendiente={pendiente("priority")} onChange={(v) => set((d) => void (d.priority.highPriorityMinScore = v))} />
          <Numero etiqueta="Conservar prospectos (días)" valor={p.retention.leadRetentionDays} pendiente={pendiente("retention")} onChange={(v) => set((d) => void (d.retention.leadRetentionDays = v))} />
        </Grupo>

        <Grupo titulo="Pesos del score (se normalizan al calcular)">
          {(["capacity", "stability", "leverage", "liquidity", "operations"] as const).map((k) => (
            <Numero
              key={k}
              etiqueta={{ capacity: "Capacidad de pago", stability: "Estabilidad", leverage: "Endeudamiento", liquidity: "Liquidez", operations: "Solidez operativa" }[k]}
              valor={p.scoring.weights[k]}
              paso={0.05}
              pendiente={pendiente("scoring.weights")}
              onChange={(v) => set((d) => void (d.scoring.weights[k] = v))}
            />
          ))}
        </Grupo>

        <Campo etiqueta="Notas para el comité (qué cambió y por qué)">
          <textarea value={notas} maxLength={1000} onChange={(e) => setNotas(e.target.value)} className="min-h-20 w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:border-finbra-purple focus:outline-none" />
        </Campo>

        {/* Mientras haya marcas de pendiente, el diagnóstico avisa a los empresarios que los parámetros no están aprobados. */}
        <label className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <input
            type="checkbox"
            checked={p.pendingApproval.length === 0}
            onChange={(e) =>
              set((d) => void (d.pendingApproval = e.target.checked ? [] : inicial.pendingApproval.length ? [...inicial.pendingApproval] : PENDIENTES_REFERENCIA))
            }
            className="mt-0.5 size-4 accent-[#5d5bdb]"
          />
          <span>
            <strong>El comité de crédito aprobó estos parámetros.</strong>
            <span className="block text-emerald-800">Quita las marcas de «pendiente» y el diagnóstico deja de decir que la política está sujeta a aprobación.</span>
          </span>
        </label>
      </fieldset>

      {estado.mensaje ? (
        <div role="status" className={`rounded-lg px-4 py-3 text-sm font-medium ${estado.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {estado.mensaje}
          {estado.detalles?.length ? (
            <ul className="mt-1 list-disc pl-5 font-normal">
              {estado.detalles.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {puedeEditar ? (
        <button type="submit" disabled={enviando} className="h-10 rounded-lg bg-finbra-purple px-5 text-sm font-semibold text-white hover:bg-finbra-purple-700 disabled:opacity-60">
          {enviando ? "Guardando…" : "Guardar como borrador"}
        </button>
      ) : (
        <p className="text-sm text-finbra-gray">Solo un Super Admin puede editar la política.</p>
      )}
    </form>
  );
}

function SelectorAccion({ valor, onChange }: { valor: AccionRegla; onChange: (v: AccionRegla) => void }) {
  return (
    <select value={valor} onChange={(e) => onChange(e.target.value as AccionRegla)} aria-label="Acción" className="h-9 w-32 rounded-lg border border-black/10 bg-white px-2 text-sm">
      {ACCIONES.map((a) => (
        <option key={a.v} value={a.v}>
          {a.l}
        </option>
      ))}
    </select>
  );
}

function Titulo({ texto, pendiente }: { texto: string; pendiente?: boolean }) {
  return (
    <div className="mb-3 flex items-center gap-2 border-b border-black/5 pb-2">
      <h3 className="text-xs font-bold uppercase tracking-wider text-finbra-purple">{texto}</h3>
      {pendiente ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">Pendiente de aprobación</span> : null}
    </div>
  );
}

function Grupo({ titulo, children, columnas = 3 }: { titulo: string; children: React.ReactNode; columnas?: 2 | 3 }) {
  return (
    <div>
      <Titulo texto={titulo} />
      <div className={`grid gap-4 sm:grid-cols-2 ${columnas === 3 ? "lg:grid-cols-3" : ""}`}>{children}</div>
    </div>
  );
}

function Campo({ etiqueta, children, className = "" }: { etiqueta: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-sm font-medium">{etiqueta}</span>
      {children}
    </label>
  );
}

function Numero({ etiqueta, valor, onChange, paso = 1, pendiente }: { etiqueta: string; valor: number; onChange: (v: number) => void; paso?: number; pendiente: boolean }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between gap-2 text-[13px] font-medium">
        {etiqueta}
        {pendiente ? <span className="text-[10px] font-bold uppercase text-amber-700" title="Pendiente de aprobación interna">Pendiente</span> : null}
      </span>
      <input type="number" step={paso} value={Number.isFinite(valor) ? valor : ""} onChange={(e) => onChange(Number(e.target.value))} className={campo} />
    </label>
  );
}
