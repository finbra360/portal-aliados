"use client";

import { useState, useTransition } from "react";
import { ESTADOS_MANUALES, ESTADOS_OPORTUNIDAD, type EstadoOportunidad } from "@/lib/clientes/renovaciones";
import { cambiarOportunidadAction } from "./actions";

const BOTON: Partial<Record<EstadoOportunidad, string>> = {
  en_contacto: "Ya lo contacté",
  interesado: "Está interesado",
  ganada: "Pasó a análisis",
  descartada: "Descartar",
};

/** Botones para mover una oportunidad abierta. Descartar pide el motivo; los demás aceptan una nota. */
export default function MoverOportunidad({ empresaId, id, estado }: { empresaId: string; id: string; estado: EstadoOportunidad }) {
  const [destino, setDestino] = useState<EstadoOportunidad | null>(null);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!destino) {
    return (
      <div className="flex flex-wrap gap-2">
        {ESTADOS_MANUALES.filter((e) => e !== estado).map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setDestino(e)}
            className={
              e === "descartada"
                ? "rounded-lg px-3 py-1.5 text-sm font-medium text-finbra-gray hover:bg-black/5"
                : "rounded-lg border border-finbra-purple/30 px-3 py-1.5 text-sm font-semibold text-finbra-purple-700 hover:bg-finbra-purple/5"
            }
          >
            {BOTON[e]}
          </button>
        ))}
      </div>
    );
  }
  const idCampo = `motivo-oportunidad-${id}`;
  return (
    <div className="space-y-2">
      <label htmlFor={idCampo} className="block text-sm text-finbra-gray">
        {destino === "descartada" ? "¿Por qué se descarta?" : `${ESTADOS_OPORTUNIDAD[destino]}: nota (opcional)`}
      </label>
      <input
        id={idCampo}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        maxLength={1000}
        autoFocus
        required={destino === "descartada"}
        placeholder={destino === "descartada" ? "Ej. Ya no necesita crédito; liquidó con recursos propios" : ""}
        className="w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await cambiarOportunidadAction(empresaId, id, destino, motivo);
              if (r.ok) {
                setDestino(null);
                setMotivo("");
              } else setError(r.error);
            })
          }
          className="rounded-lg bg-finbra-purple px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" onClick={() => { setDestino(null); setError(null); }} className="text-sm text-finbra-gray hover:underline">
          Volver
        </button>
        {error && <span className="text-sm text-red-700" role="alert">{error}</span>}
      </div>
    </div>
  );
}
