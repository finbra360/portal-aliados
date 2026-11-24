"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { asignarEjecutivoAction, type AsignarResult } from "./actions";

/** Id del formulario; las casillas de cada fila se ligan a él con el atributo `form`. */
export const FORM_ASIGNAR = "asignar-ejecutivo";
const SIN = "__sin__";

/**
 * Barra para asignar el ejecutivo de varias empresas de la lista a la vez. Las
 * casillas viven en la tabla (que se pinta en el servidor) y se ligan a este
 * formulario por su atributo `form`; aquí solo se cuentan y se mandan.
 */
const casillas = () => [...document.querySelectorAll<HTMLInputElement>(`input[name="empresa"][form="${FORM_ASIGNAR}"]`)];
const elegidasAhora = () => casillas().filter((c) => c.checked).length;

export default function AsignarEjecutivo({ ejecutivos, visibles }: { ejecutivos: { email: string; nombre: string }[]; visibles: number }) {
  const router = useRouter();
  const [elegidas, setElegidas] = useState(0);
  const [r, setR] = useState<AsignarResult | null>(null);
  const [pending, start] = useTransition();
  const contar = () => setElegidas(elegidasAhora());

  // Las casillas de la tabla cambian fuera de React: se cuentan al cambiar y
  // cada vez que la lista se vuelve a pintar (otro filtro o búsqueda).
  useEffect(() => {
    const alCambiar = (e: Event) => {
      const t = e.target as HTMLInputElement | null;
      if (t?.name === "empresa" && t.getAttribute("form") === FORM_ASIGNAR) setElegidas(elegidasAhora());
    };
    document.addEventListener("change", alCambiar);
    setElegidas(elegidasAhora());
    return () => document.removeEventListener("change", alCambiar);
  }, [visibles]);

  function marcarTodas(marcar: boolean) {
    for (const c of casillas()) c.checked = marcar;
    contar();
  }

  function enviar(fd: FormData) {
    const ids = casillas().filter((c) => c.checked).map((c) => c.value);
    const valor = String(fd.get("ejecutivo") ?? "");
    if (!ids.length || !valor) return;
    start(async () => {
      const res = await asignarEjecutivoAction(ids, valor === SIN ? null : valor);
      setR(res);
      if (res.ok) {
        marcarTodas(false);
        router.refresh();
      }
    });
  }

  return (
    <form
      id={FORM_ASIGNAR}
      action={enviar}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-finbra-purple/20 bg-finbra-purple/5 px-4 py-3 text-sm"
    >
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          aria-label="Elegir todas las empresas de la lista"
          checked={visibles > 0 && elegidas === visibles}
          disabled={visibles === 0}
          ref={(el) => {
            if (el) el.indeterminate = elegidas > 0 && elegidas < visibles;
          }}
          onChange={(e) => marcarTodas(e.target.checked)}
          className="h-4 w-4 accent-finbra-purple"
        />
        <span className="font-medium">{elegidas ? `${elegidas} ${elegidas === 1 ? "elegida" : "elegidas"}` : "Elegir todas"}</span>
      </label>
      <label htmlFor="asignar-a" className="text-finbra-gray">
        Asignar a
      </label>
      <select id="asignar-a" name="ejecutivo" defaultValue="" required className="rounded-lg border border-black/10 bg-white px-3 py-1.5">
        <option value="" disabled>
          Elige un ejecutivo
        </option>
        {ejecutivos.map((u) => (
          <option key={u.email} value={u.email}>
            {u.nombre}
          </option>
        ))}
        <option value={SIN}>Sin ejecutivo</option>
      </select>
      <button
        type="submit"
        disabled={pending || elegidas === 0}
        className="rounded-lg bg-finbra-purple px-4 py-1.5 font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50"
      >
        {pending ? "Asignando…" : "Asignar"}
      </button>
      {r && (r.ok ? <p className="text-emerald-700" role="status">{r.mensaje}</p> : <p className="text-red-700" role="alert">{r.error}</p>)}
    </form>
  );
}
