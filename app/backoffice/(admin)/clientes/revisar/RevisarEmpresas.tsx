"use client";

// «Empresas por revisar»: cada prospecto que se parece a otra empresa, con las
// sugerencias. «Juntar» pasa todo a la elegida y borra el prospecto; «Es otra
// empresa» lo quita de la lista. Cada renglón se resuelve por separado.

import { useState, useTransition } from "react";
import Link from "next/link";
import type { EmpresaJuntar, Sugerencia } from "@/lib/clientes/juntar";
import { juntarEmpresaAction, marcarRevisadaAction } from "../juntar-actions";

const BASE = "/backoffice/clientes";
const boton = "rounded-lg bg-finbra-purple px-3 py-1.5 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
const secundario = "rounded-lg border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50";

type Renglon = { empresa: EmpresaJuntar; sugerencias: Sugerencia[] };

function Fila({ r, onListo }: { r: Renglon; onListo: (texto: string) => void }) {
  const [elegida, setElegida] = useState(r.sugerencias[0].id);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, start] = useTransition();
  const destino = r.sugerencias.find((s) => s.id === elegida)!;

  const juntar = () => {
    if (!window.confirm(`¿Juntar «${r.empresa.nombre}» con «${destino.nombre}»? Sus negocios, contactos y tareas pasan a «${destino.nombre}» y «${r.empresa.nombre}» se borra. No se puede deshacer.`)) return;
    start(async () => {
      const x = await juntarEmpresaAction(destino.id, r.empresa.id);
      if (x.ok) onListo(x.mensaje);
      else setError(x.error);
    });
  };
  const esOtra = () =>
    start(async () => {
      const x = await marcarRevisadaAction(r.empresa.id);
      if (x.ok) onListo(`«${r.empresa.nombre}» se queda como empresa aparte.`);
      else setError(x.error);
    });

  return (
    <li className="space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p>
          <Link href={`${BASE}/${r.empresa.id}`} className="font-semibold hover:text-finbra-purple hover:underline">{r.empresa.nombre}</Link>
          <span className="text-sm text-finbra-gray">
            {" "}· prospecto · {r.empresa.negocios} {r.empresa.negocios === 1 ? "negocio" : "negocios"}
          </span>
        </p>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-xs text-finbra-gray">¿Es la misma que…?</legend>
        {r.sugerencias.map((s) => (
          <label key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
            <input type="radio" name={`destino-${r.empresa.id}`} checked={elegida === s.id} onChange={() => setElegida(s.id)} />
            <span className="font-medium">{s.nombre}</span>
            <span className="text-xs text-finbra-gray">
              {s.esCliente ? "cliente de SIAC" : "prospecto"} · {s.negocios} {s.negocios === 1 ? "negocio" : "negocios"} · {Math.round(s.parecido * 100)} % parecido
            </span>
            <Link href={`${BASE}/${s.id}`} className="text-xs text-finbra-purple hover:underline" target="_blank">ver</Link>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={juntar} disabled={pendiente} className={boton}>
          {pendiente ? "Guardando…" : `Juntar con ${destino.nombre}`}
        </button>
        <button type="button" onClick={esOtra} disabled={pendiente} className={secundario}>
          Es otra empresa
        </button>
        {error && <p className="w-full text-sm text-red-700" role="alert">{error}</p>}
      </div>
    </li>
  );
}

export default function RevisarEmpresas({ renglones }: { renglones: Renglon[] }) {
  const [hechos, setHechos] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState<string | null>(null);
  const pendientes = renglones.filter((r) => !hechos.has(r.empresa.id));
  return (
    <div className="space-y-3">
      {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{aviso}</p>}
      {pendientes.length === 0 ? (
        <p className="text-sm text-finbra-gray">No hay empresas por revisar.</p>
      ) : (
        <>
          <p className="text-sm text-finbra-gray">{pendientes.length} por revisar.</p>
          <ul className="divide-y divide-black/5">
            {pendientes.map((r) => (
              <Fila
                key={r.empresa.id}
                r={r}
                onListo={(texto) => {
                  setAviso(texto);
                  setHechos((s) => new Set(s).add(r.empresa.id));
                }}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
