"use client";

// Ligar un negocio dispersado con su crédito de SIAC: las sugerencias, con un
// botón cada una, o el número de crédito a mano. Pide confirmar porque, si
// SIAC le creó otra empresa al cliente, se junta con la del negocio.

import { useActionState } from "react";
import { llaveCredito, type Sugerencia } from "@/lib/clientes/siac-liga";
import { etiquetaEstado } from "@/lib/clientes/siac-historico";
import { formatMoney } from "@/lib/format";
import { ligarCreditoSiacAction, type NegocioResult } from "../actions";

const boton = "rounded-lg bg-finbra-purple px-3 py-1.5 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
const AVISO = "¿Ligar este negocio con el crédito? Si SIAC le creó otra empresa al cliente, se junta con esta y no se puede deshacer.";

function Aviso({ r }: { r: NegocioResult | null }) {
  if (!r) return null;
  return r.ok ? (
    <p className="text-sm text-emerald-700" role="status">{r.mensaje}</p>
  ) : (
    <p className="text-sm text-red-700" role="alert">{r.error}</p>
  );
}

export function LigarSiac({ id, sugerencias }: { id: string; sugerencias: Sugerencia[] }) {
  const [r, accion, guardando] = useActionState(ligarCreditoSiacAction.bind(null, id), null);
  const confirmar = (e: React.FormEvent) => {
    if (!window.confirm(AVISO)) e.preventDefault();
  };
  return (
    <div className="space-y-4">
      {sugerencias.length === 0 ? (
        <p className="text-sm text-finbra-gray">
          Todavía no vemos un crédito parecido en SIAC. Aparece en la foto del día siguiente a la dispersión; si ya está, búscalo por su número.
        </p>
      ) : (
        <ul className="divide-y divide-black/5 rounded-lg border border-black/5">
          {sugerencias.map((s) => (
            <li key={llaveCredito(s)} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p>
                  <span className="font-semibold">{s.cliente}</span>
                  <span className="text-finbra-gray"> · crédito {s.noCredito}</span>
                  {s.monto !== null && <span className="tabular-nums"> · {formatMoney(s.monto)}</span>}
                  {s.historico && s.estado && (
                    <span className="ml-2 rounded-full bg-black/5 px-2 py-0.5 text-xs font-semibold text-finbra-gray">{etiquetaEstado(s.estado)}</span>
                  )}
                </p>
                <p className="text-xs text-finbra-gray">{s.razones.join(" · ")}</p>
              </div>
              <form action={accion} onSubmit={confirmar}>
                <input type="hidden" name={s.historico ? "historicoId" : "creditId"} value={s.creditId} />
                <button type="submit" disabled={guardando} className={boton}>{guardando ? "Ligando…" : "Es este"}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={accion} onSubmit={confirmar} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="noCredito" className="block text-sm font-medium">¿No está? Número de crédito de SIAC</label>
          <input id="noCredito" name="noCredito" maxLength={40} required className="rounded-lg border border-black/10 bg-white px-3 py-2 font-mono text-sm sm:w-56" />
        </div>
        <button type="submit" disabled={guardando} className={boton}>{guardando ? "Ligando…" : "Ligar"}</button>
      </form>
      <Aviso r={r} />
    </div>
  );
}
